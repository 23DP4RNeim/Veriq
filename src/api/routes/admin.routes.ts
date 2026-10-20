import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../app/config.js';
import type { PrismaClient } from '@prisma/client';
import type { CompanyApplicationService } from '../../modules/companies/company.service.js';
import { validAdminToken } from '../../shared/admin-auth.js';
import { AppError } from '../../shared/app-error.js';
import { identifyQuery, namesMatch } from '../../modules/companies/company.normalization.js';
import type { CompanyRecord } from '../../modules/companies/company.types.js';
import { MOCK_COMPANIES } from '../../modules/providers/mock/companies.data.js';
import { VerificationEngine } from '../../modules/verification/verification.engine.js';
import type { VerificationResult } from '../../modules/verification/verification.types.js';

interface AdminRouteDependencies {
  config: AppConfig;
  prisma: PrismaClient;
  companies: CompanyApplicationService;
}

interface PageQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
}

interface LocalLookup {
  id: string;
  query: string;
  platform: 'web';
  resultStatus: string;
  createdAt: Date;
  company: { id: string; name: string; registrationNumber: string } | null;
  verification: VerificationResult | null;
}

function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function authorized(request: FastifyRequest, token: string): boolean {
  if (!token) return isLoopback(request.ip);
  return validAdminToken(request.headers.authorization, token);
}

function pageOptions(query: PageQuery) {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 25)));
  return { page, limit, skip: (page - 1) * limit };
}

const pageQuerySchema = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    q: { type: 'string', maxLength: 200 },
    status: { type: 'string', maxLength: 40 },
  },
} as const;

export const adminRoutes: FastifyPluginAsync<AdminRouteDependencies> = async (app, { config, prisma, companies }) => {
  const localLookups: LocalLookup[] = [];
  const verificationEngine = new VerificationEngine();
  let databaseState: { ready: boolean; checkedAt: number } | null = null;
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  app.addHook('preHandler', async (request, reply) => {
    if (!authorized(request, config.ADMIN_TOKEN)) {
      reply.code(config.ADMIN_TOKEN ? 401 : 403);
      return reply.send({ error: { code: 'ADMIN_ACCESS_DENIED', message: 'Admin access is not available from this address or token.' } });
    }
  });
  const isDatabaseReady = async (request: FastifyRequest): Promise<boolean> => {
    if (databaseState && Date.now() - databaseState.checkedAt < 5000) {
      if (!databaseState.ready && config.NODE_ENV === 'production') throw new AppError('PROVIDER_UNAVAILABLE', 'Database is unavailable.');
      return databaseState.ready;
    }
    try {
      const [result] = await prisma.$queryRaw<Array<{ ready: boolean }>>`
        SELECT to_regclass('public.companies') IS NOT NULL
          AND to_regclass('public.lookup_history') IS NOT NULL AS ready
      `;
      databaseState = { ready: result?.ready === true, checkedAt: Date.now() };
      if (!databaseState.ready && config.NODE_ENV === 'production') throw new AppError('PROVIDER_UNAVAILABLE', 'Database schema is not ready. Run the Supabase setup SQL.');
      return databaseState.ready;
    } catch (error) {
      request.log.warn({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Admin database is unavailable');
      if (config.NODE_ENV === 'production') throw new AppError('PROVIDER_UNAVAILABLE', 'Database is unavailable. Please try again later.');
      databaseState = { ready: false, checkedAt: Date.now() };
      return false;
    }
  };
  const pageResult = <T>(allItems: T[], query: PageQuery) => {
    const { page, limit, skip } = pageOptions(query);
    return { items: allItems.slice(skip, skip + limit), page, limit, total: allItems.length, pages: Math.ceil(allItems.length / limit) };
  };
  const localMatch = (company: CompanyRecord) => ({
    id: company.id,
    registrationNumber: company.registrationNumber,
    name: company.name,
    status: company.status,
  });
  const companyRecord = (company: CompanyRecord) => ({
    ...company,
    registrationDate: company.registrationDate?.toISOString().slice(0, 10) ?? null,
    liquidationDate: company.liquidationDate?.toISOString().slice(0, 10) ?? null,
    lastAnnualReportDate: company.lastAnnualReportDate?.toISOString().slice(0, 10) ?? null,
    sourceLastUpdated: company.sourceLastUpdated?.toISOString() ?? null,
    totalAssets: company.totalAssets ?? null,
    equity: company.equity ?? null,
    totalLiabilities: company.totalLiabilities ?? null,
    financialYear: company.financialYear ?? null,
    financialCurrency: company.financialCurrency ?? null,
    paidUpCapital: company.paidUpCapital ?? null,
    capitalCurrency: company.capitalCurrency ?? null,
  });
  const localQuery = (query: PageQuery) => query.q?.trim().toLocaleLowerCase('lv-LV') ?? '';
  const filteredLocalCompanies = (query: PageQuery) => {
    const search = localQuery(query);
    return MOCK_COMPANIES.filter((company) =>
      (!search || company.name.toLocaleLowerCase('lv-LV').includes(search) || company.registrationNumber.includes(search)) &&
      (!query.status || company.status === query.status),
    );
  };
  const localLookupMatches = (query: PageQuery) => {
    const search = localQuery(query);
    return localLookups.filter((item) =>
      (!search || item.query.toLocaleLowerCase('lv-LV').includes(search) || item.company?.name.toLocaleLowerCase('lv-LV').includes(search) || item.company?.registrationNumber.includes(search)) &&
      (!query.status || item.resultStatus === query.status),
    );
  };
  const localReportMatches = (query: PageQuery) => {
    const search = localQuery(query);
    return localLookups.filter((item) =>
      item.verification && item.company &&
      (!search || item.query.toLocaleLowerCase('lv-LV').includes(search) || item.company?.name.toLocaleLowerCase('lv-LV').includes(search)) &&
      (!query.status || item.resultStatus === query.status),
    );
  };
  const localActivity = () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    const since7d = new Date(today);
    since7d.setUTCDate(since7d.getUTCDate() - 6);
    const todayLookups = localLookups.filter((item) => item.createdAt >= today);
    const evaluated = localLookups.filter((item) => ['VERIFIED', 'WARNING', 'NOT_VERIFIED'].includes(item.resultStatus));
    const verified = evaluated.filter((item) => item.resultStatus === 'VERIFIED').length;
    const dailyQueries = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(since7d);
      day.setUTCDate(day.getUTCDate() + index);
      const start = day.getTime();
      const end = start + 24 * 60 * 60 * 1000;
      return { day: day.toISOString().slice(0, 10), count: localLookups.filter((item) => item.createdAt.getTime() >= start && item.createdAt.getTime() < end).length };
    });
    const byCompany = new Map<string, { company: NonNullable<LocalLookup['company']>; queries: number }>();
    for (const item of localLookups) {
      if (!item.company) continue;
      const current = byCompany.get(item.company.id);
      if (current) current.queries += 1;
      else byCompany.set(item.company.id, { company: item.company, queries: 1 });
    }
    return {
      metrics: {
        queriesToday: todayLookups.length,
        activeLookups: localLookups.filter((item) => item.createdAt.getTime() >= since24h).length,
        companiesIndexed: MOCK_COMPANIES.length,
        reportsSaved: localLookups.filter((item) => item.verification).length,
        verificationPassRate: evaluated.length ? Math.round((verified / evaluated.length) * 1000) / 10 : null,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      dailyQueries,
      recent: [...localLookups].reverse().slice(0, 6),
      topCompanies: [...byCompany.values()].sort((a, b) => b.queries - a.queries).slice(0, 5),
      dataMode: 'session_mock' as const,
    };
  };

  app.get('/session', async (request) => ({
    authenticated: true,
    mode: config.ADMIN_TOKEN ? 'token' : 'local',
    address: request.ip,
  }));

  app.post<{ Body: { query: string } }>('/trace', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (request) => {
    const query = request.body.query.trim();
    if (await isDatabaseReady(request)) {
      const outcome = await companies.verify(query, { platform: 'web' });
      return {
        status: outcome.status,
        company: outcome.company ? companyRecord(outcome.company) : null,
        verification: outcome.verification,
        matches: 'matches' in outcome ? outcome.matches : undefined,
        source: 'source' in outcome ? outcome.source : 'database',
        dataMode: 'database',
      };
    }
    const identified = identifyQuery(query);
    const matches = identified.kind === 'registration_number'
      ? MOCK_COMPANIES.filter((company) => company.registrationNumber === identified.normalized)
      : MOCK_COMPANIES.filter((company) => namesMatch(query, company));
    const company = matches.length === 1 ? matches[0] ?? null : null;
    const verification = matches.length > 1
      ? null
      : company
        ? verificationEngine.evaluate(company, { query, queryKind: identified.kind })
        : verificationEngine.notFound();
    const resultStatus = matches.length > 1 ? 'MULTIPLE_MATCHES' : verification?.status ?? 'NOT_FOUND';
    const lookup: LocalLookup = {
      id: randomUUID(),
      query,
      platform: 'web',
      resultStatus,
      createdAt: new Date(),
      company: company ? { id: company.id, name: company.name, registrationNumber: company.registrationNumber } : null,
      verification,
    };
    localLookups.push(lookup);
    return {
      status: resultStatus,
      company: company ? companyRecord(company) : null,
      verification,
      matches: matches.length > 1 ? matches.map(localMatch) : undefined,
      source: 'Mock Provider',
      dataMode: 'session_mock',
    };
  });

  app.get<{ Params: { id: string } }>('/companies/:id', async (request, reply) => {
    if (await isDatabaseReady(request)) {
      const company = await prisma.company.findUnique({ where: { id: request.params.id } });
      if (company) return { ...company, sourceLastUpdated: company.sourceLastUpdated?.toISOString() ?? null };
    }
    const company = MOCK_COMPANIES.find((item) => item.id === request.params.id);
    if (!company) {
      reply.code(404);
      return { error: { code: 'COMPANY_NOT_FOUND', message: 'Company was not found.' } };
    }
    return { ...companyRecord(company), dataMode: 'session_mock' };
  });

  app.get<{ Params: { id: string } }>('/reports/:id', async (request, reply) => {
    if (await isDatabaseReady(request)) {
      const report = await prisma.verificationReport.findUnique({
        where: { lookupHistoryId: request.params.id },
        include: { company: true, lookupHistory: { select: { id: true, query: true, resultStatus: true, createdAt: true } } },
      });
      if (report) return {
        id: report.id,
        lookup: report.lookupHistory,
        company: report.company,
        verification: report.result,
        dataMode: 'database',
      };
    }
    const item = localLookups.find((lookup) => lookup.id === request.params.id && lookup.verification);
    if (!item || !item.company) {
      reply.code(404);
      return { error: { code: 'REPORT_NOT_FOUND', message: 'No in-memory verification report was found.' } };
    }
    const company = MOCK_COMPANIES.find((record) => record.id === item.company?.id);
    return {
      id: item.id,
      lookup: { id: item.id, query: item.query, resultStatus: item.resultStatus, createdAt: item.createdAt },
      company: company ? companyRecord(company) : item.company,
      verification: item.verification,
      dataMode: 'session_mock',
    };
  });

  app.get('/dashboard', async (request) => {
    if (!(await isDatabaseReady(request))) return localActivity();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);

    const [queriesToday, activeLookups, companyCount, reportCount, statusCounts, dailyRows, recent, popular] = await Promise.all([
      prisma.lookupHistory.count({ where: { createdAt: { gte: today } } }),
      prisma.lookupHistory.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      prisma.company.count(),
      prisma.verificationReport.count(),
      prisma.lookupHistory.groupBy({ by: ['resultStatus'], _count: { _all: true }, where: { createdAt: { gte: today } } }),
      prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::bigint AS count
        FROM lookup_history
        WHERE created_at >= ${weekAgo}
        GROUP BY date_trunc('day', created_at)
        ORDER BY day
      `,
      prisma.lookupHistory.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true, query: true, platform: true, resultStatus: true, createdAt: true,
          company: { select: { id: true, name: true, registrationNumber: true } },
        },
      }),
      prisma.lookupHistory.groupBy({
        by: ['companyId'], where: { companyId: { not: null } }, _count: { _all: true },
        orderBy: { _count: { companyId: 'desc' } }, take: 5,
      }),
    ]);
    const popularIds = popular.flatMap((item) => item.companyId ? [item.companyId] : []);
    const popularCompanies = await prisma.company.findMany({
      where: { id: { in: popularIds } },
      select: { id: true, name: true, registrationNumber: true, status: true },
    });
    const popularMap = new Map(popularCompanies.map((company) => [company.id, company]));
    const completed = statusCounts.reduce((sum, item) =>
      sum + (item.resultStatus === 'VERIFIED' ? item._count._all : 0), 0);
    const evaluated = statusCounts.reduce((sum, item) =>
      sum + (['VERIFIED', 'WARNING', 'NOT_VERIFIED'].includes(item.resultStatus) ? item._count._all : 0), 0);

    return {
      metrics: {
        queriesToday,
        activeLookups,
        companiesIndexed: companyCount,
        reportsSaved: reportCount,
        verificationPassRate: evaluated ? Math.round((completed / evaluated) * 1000) / 10 : null,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      dailyQueries: dailyRows.map((row) => ({ day: row.day.toISOString().slice(0, 10), count: Number(row.count) })),
      recent: recent.map((lookup) => ({
        ...lookup,
        query: lookup.query.slice(0, 200),
      })),
      topCompanies: popular.map((item) => ({
        company: item.companyId ? popularMap.get(item.companyId) ?? null : null,
        queries: item._count._all,
      })).filter((item) => item.company !== null),
      dataMode: 'database',
    };
  });

  app.get<{ Querystring: PageQuery }>('/conversations', { schema: { querystring: pageQuerySchema } }, async (request) => {
    if (!(await isDatabaseReady(request))) return { ...pageResult(localLookupMatches(request.query), request.query), dataMode: 'session_mock', notice: 'Only lookups made during this server session are available without PostgreSQL.' };
    const { page, limit, skip } = pageOptions(request.query);
    const q = request.query.q?.trim();
    const where = q ? {
      OR: [
        { query: { contains: q, mode: 'insensitive' as const } },
        { company: { name: { contains: q, mode: 'insensitive' as const } } },
        { company: { registrationNumber: { contains: q, mode: 'insensitive' as const } } },
      ],
    } : {};
    const [items, total] = await Promise.all([
      prisma.lookupHistory.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: limit,
        select: {
          id: true, query: true, platform: true, resultStatus: true, createdAt: true, userId: true,
          company: { select: { id: true, name: true, registrationNumber: true } },
          user: { select: { botUsers: { select: { platform: true, username: true, firstName: true, lastName: true } } } },
        },
      }),
      prisma.lookupHistory.count({ where }),
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit), dataMode: 'database' };
  });

  app.get<{ Querystring: PageQuery }>('/companies', { schema: { querystring: pageQuerySchema } }, async (request) => {
    if (!(await isDatabaseReady(request))) {
      const items = filteredLocalCompanies(request.query).map((company) => ({
        id: company.id, registrationNumber: company.registrationNumber, name: company.name, status: company.status,
        legalForm: company.legalForm, city: company.city, country: company.country, vatRegistered: company.vatRegistered,
        insolvencyStatus: company.insolvencyStatus, sanctionsStatus: company.sanctionsStatus,
        sourceLastUpdated: company.sourceLastUpdated, updatedAt: company.sourceLastUpdated,
      }));
      return { ...pageResult(items, request.query), dataMode: 'session_mock' };
    }
    const { page, limit, skip } = pageOptions(request.query);
    const q = request.query.q?.trim();
    const where = {
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { registrationNumber: { contains: q, mode: 'insensitive' as const } },
      ] } : {}),
      ...(request.query.status ? { status: request.query.status as 'ACTIVE' | 'LIQUIDATED' | 'UNKNOWN' } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.company.findMany({
        where, orderBy: { updatedAt: 'desc' }, skip, take: limit,
        select: {
          id: true, registrationNumber: true, name: true, status: true, legalForm: true, city: true,
          country: true, vatRegistered: true, insolvencyStatus: true, sanctionsStatus: true,
          sourceLastUpdated: true, updatedAt: true,
        },
      }),
      prisma.company.count({ where }),
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit), dataMode: 'database' };
  });

  app.get<{ Querystring: PageQuery }>('/reports', { schema: { querystring: pageQuerySchema } }, async (request) => {
    if (!(await isDatabaseReady(request))) {
      const items = localReportMatches(request.query).map((item) => ({
        id: item.id, createdAt: item.createdAt, result: item.verification,
        company: item.company,
        lookupHistory: { id: item.id, query: item.query, resultStatus: item.resultStatus, platform: item.platform, createdAt: item.createdAt },
      }));
      return { ...pageResult(items, request.query), dataMode: 'session_mock' };
    }
    const { page, limit, skip } = pageOptions(request.query);
    const where = request.query.status ? { lookupHistory: { resultStatus: request.query.status } } : {};
    const [items, total] = await Promise.all([
      prisma.verificationReport.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: limit,
        select: {
          id: true, createdAt: true, result: true,
          company: { select: { id: true, name: true, registrationNumber: true } },
          lookupHistory: { select: { id: true, query: true, resultStatus: true, platform: true, createdAt: true } },
        },
      }),
      prisma.verificationReport.count({ where }),
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit), dataMode: 'database' };
  });

  app.get('/analytics', async (request) => {
    if (!(await isDatabaseReady(request))) {
      const activity = localActivity();
      const counts = new Map<string, number>();
      for (const item of localLookups) counts.set(item.resultStatus, (counts.get(item.resultStatus) ?? 0) + 1);
      return {
        totals: { queries: localLookups.length, companies: MOCK_COMPANIES.length, reports: activity.metrics.reportsSaved },
        dailyQueries: activity.dailyQueries,
        platforms: localLookups.length ? [{ name: 'web', count: localLookups.length }] : [],
        outcomes: [...counts].map(([name, count]) => ({ name, count })),
        dataMode: 'session_mock',
      };
    }
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [dailyRows, byPlatform, byStatus, queryCount, companyCount, reportCount] = await Promise.all([
      prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::bigint AS count
        FROM lookup_history WHERE created_at >= ${since}
        GROUP BY date_trunc('day', created_at) ORDER BY day
      `,
      prisma.lookupHistory.groupBy({ by: ['platform'], _count: { _all: true }, where: { createdAt: { gte: since } } }),
      prisma.lookupHistory.groupBy({ by: ['resultStatus'], _count: { _all: true }, where: { createdAt: { gte: since } } }),
      prisma.lookupHistory.count({ where: { createdAt: { gte: since } } }),
      prisma.company.count(),
      prisma.verificationReport.count({ where: { createdAt: { gte: since } } }),
    ]);
    return {
      totals: { queries: queryCount, companies: companyCount, reports: reportCount },
      dailyQueries: dailyRows.map((row) => ({ day: row.day.toISOString().slice(0, 10), count: Number(row.count) })),
      platforms: byPlatform.map((item) => ({ name: item.platform, count: item._count._all })),
      outcomes: byStatus.map((item) => ({ name: item.resultStatus, count: item._count._all })),
      dataMode: 'database',
    };
  });

  app.get<{ Querystring: PageQuery }>('/users', { schema: { querystring: pageQuerySchema } }, async (request) => {
    if (!(await isDatabaseReady(request))) return { ...pageResult([], request.query), dataMode: 'session_mock', notice: 'User records are persisted in PostgreSQL and are not available offline.' };
    const { page, limit, skip } = pageOptions(request.query);
    const q = request.query.q?.trim();
    const where = q ? { OR: [
      { name: { contains: q, mode: 'insensitive' as const } },
      { email: { contains: q, mode: 'insensitive' as const } },
      { botUsers: { some: { username: { contains: q, mode: 'insensitive' as const } } } },
    ] } : {};
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: limit,
        select: {
          id: true, name: true, email: true, createdAt: true,
          botUsers: { select: { platform: true, username: true, firstName: true, lastName: true } },
          _count: { select: { lookups: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit), dataMode: 'database' };
  });

  app.get('/settings', async (request) => ({
    provider: config.COMPANY_PROVIDER,
    telegram: config.TELEGRAM_BOT_TOKEN ? 'configured' : 'not_configured',
    whatsapp: config.WHATSAPP_ENABLED ? 'enabled' : 'disabled',
    rateLimitRequests: config.RATE_LIMIT_REQUESTS,
    rateLimitWindowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
    uptimeSeconds: Math.floor(process.uptime()),
    nodeEnvironment: config.NODE_ENV,
    adminAuthentication: config.ADMIN_TOKEN ? 'token_required' : 'loopback_only',
    database: await isDatabaseReady(request) ? 'connected' : 'unavailable',
  }));

  app.get('/api-keys', async () => ({
    items: [],
    message: 'This application does not store API keys. Provider credentials are configured through environment variables.',
  }));
};
