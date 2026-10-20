import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Company, PrismaClient } from '@prisma/client';
import type { CompanyApplicationService } from '../../modules/companies/company.service.js';
import type { CompanyRecord } from '../../modules/companies/company.types.js';
import type { RateLimitService } from '../../modules/rate-limit/rate-limit.service.js';
import type { HistoryService } from '../../modules/users/user.service.js';
import { AppError } from '../../shared/app-error.js';

export interface ApiRouteDependencies {
  companies: CompanyApplicationService;
  history: HistoryService;
  rateLimit: RateLimitService;
  prisma: PrismaClient;
  telegramConfigured: boolean;
}

const queryBody = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 200, description: 'Latvian registration number or company name' },
    companyName: { type: 'string', minLength: 2, maxLength: 200, description: 'Optional expected name to compare against a registration number' },
  },
} as const;

interface SearchBody { query: string; }
interface VerifyBody { query: string; companyName?: string; }

const idParams = {
  type: 'object', additionalProperties: false, required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

function publicCompany(company: CompanyRecord) {
  return {
    id: company.id,
    registrationNumber: company.registrationNumber,
    name: company.name,
    previousNames: company.previousNames,
    legalForm: company.legalForm,
    status: company.status,
    registrationDate: company.registrationDate?.toISOString().slice(0, 10) ?? null,
    liquidationDate: company.liquidationDate?.toISOString().slice(0, 10) ?? null,
    legalAddress: company.legalAddress,
    postalCode: company.postalCode,
    city: company.city,
    country: company.country,
    vatRegistered: company.vatRegistered,
    vatNumber: company.vatNumber,
    industryCode: company.industryCode,
    industryName: company.industryName,
    boardMembers: company.boardMembers,
    shareholders: company.shareholders,
    beneficialOwners: company.beneficialOwners,
    annualReportAvailable: company.annualReportAvailable,
    lastAnnualReportDate: company.lastAnnualReportDate?.toISOString().slice(0, 10) ?? null,
    revenue: company.revenue,
    profit: company.profit,
    employeeCount: company.employeeCount,
    totalAssets: company.totalAssets ?? null,
    equity: company.equity ?? null,
    totalLiabilities: company.totalLiabilities ?? null,
    financialYear: company.financialYear ?? null,
    financialCurrency: company.financialCurrency ?? null,
    paidUpCapital: company.paidUpCapital ?? null,
    capitalCurrency: company.capitalCurrency ?? null,
    insolvencyStatus: company.insolvencyStatus,
    sanctionsStatus: company.sanctionsStatus,
    dataSource: company.dataSource,
    sourceLastUpdated: company.sourceLastUpdated?.toISOString() ?? null,
  };
}

function publicStoredCompany(company: Company) {
  return {
    id: company.id,
    registrationNumber: company.registrationNumber,
    name: company.name,
    previousNames: company.previousNames,
    legalForm: company.legalForm,
    status: company.status,
    registrationDate: company.registrationDate?.toISOString().slice(0, 10) ?? null,
    liquidationDate: company.liquidationDate?.toISOString().slice(0, 10) ?? null,
    legalAddress: company.legalAddress,
    postalCode: company.postalCode,
    city: company.city,
    country: company.country,
    vatRegistered: company.vatRegistered,
    vatNumber: company.vatNumber,
    industryCode: company.industryCode,
    industryName: company.industryName,
    boardMembers: company.boardMembers,
    shareholders: company.shareholders,
    beneficialOwners: company.beneficialOwners,
    annualReportAvailable: company.annualReportAvailable,
    lastAnnualReportDate: company.lastAnnualReportDate?.toISOString().slice(0, 10) ?? null,
    revenue: company.revenue,
    profit: company.profit,
    employeeCount: company.employeeCount,
    totalAssets: company.totalAssets,
    equity: company.equity,
    totalLiabilities: company.totalLiabilities,
    financialYear: company.financialYear,
    financialCurrency: company.financialCurrency,
    paidUpCapital: company.paidUpCapital,
    capitalCurrency: company.capitalCurrency,
    insolvencyStatus: company.insolvencyStatus,
    sanctionsStatus: company.sanctionsStatus,
    dataSource: company.dataSource,
    sourceLastUpdated: company.sourceLastUpdated?.toISOString() ?? null,
  };
}

export const v1Routes: FastifyPluginAsync<ApiRouteDependencies> = async (app, dependencies) => {
  const limitHttpRequest = async (request: FastifyRequest): Promise<void> => {
    await dependencies.rateLimit.consume(`http:${request.ip}`);
  };

  const searchHandler = async (request: FastifyRequest<{ Body: SearchBody }>) => {
    await limitHttpRequest(request);
    return dependencies.companies.search(request.body.query);
  };

  const verifyHandler = async (request: FastifyRequest<{ Body: VerifyBody }>) => {
    await limitHttpRequest(request);
    const outcome = await dependencies.companies.verify(request.body.query, undefined, request.body.companyName);
    if (outcome.status === 'MULTIPLE_MATCHES') {
      return {
        status: outcome.status,
        message: 'Multiple companies found. Select one to continue.',
        matches: outcome.matches,
        source: outcome.source,
      };
    }
    return {
      company: outcome.company ? publicCompany(outcome.company) : null,
      verification: outcome.verification,
      source: outcome.source,
    };
  };

  app.get('/health', {
    schema: {
      tags: ['health'], summary: 'Service and dependency health',
      response: {
        200: { type: 'object', properties: { status: { type: 'string' }, database: { type: 'string' }, provider: { type: 'string' }, telegram: { type: 'string' } } },
        503: { type: 'object', properties: { status: { type: 'string' }, database: { type: 'string' }, provider: { type: 'string' }, telegram: { type: 'string' } } },
      },
    },
  }, async (_request, reply) => {
    const database = await dependencies.companies.health();
    const status = database === 'ok' ? 'ok' : 'degraded';
    if (status !== 'ok') reply.code(503);
    return {
      status,
      database,
      provider: dependencies.companies.providerName,
      telegram: dependencies.telegramConfigured ? 'configured' : 'not_configured',
    };
  });

  app.post('/companies/search', {
    schema: {
      tags: ['companies'], summary: 'Search companies by Latvian registration number or name', body: queryBody,
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, searchHandler);

  app.post('/companies/verify', {
    schema: {
      tags: ['verification'], summary: 'Run a structured company verification', body: queryBody,
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, verifyHandler);

  app.post('/verification', {
    schema: {
      tags: ['verification'], summary: 'Run a structured company verification', body: queryBody,
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, verifyHandler);

  app.get<{ Params: { id: string } }>('/companies/:id', {
    schema: {
      tags: ['companies'], summary: 'Get company details', params: idParams,
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request) => {
    const company = await dependencies.companies.getCompanyById(request.params.id);
    if (!company) throw new AppError('COMPANY_NOT_FOUND', 'Company was not found.');
    return publicCompany(company);
  });

  app.get<{ Params: { id: string } }>('/companies/:id/history', {
    schema: { tags: ['history'], summary: 'Get recent lookup history for a company', params: idParams },
  }, async (request) => dependencies.history.forCompany(request.params.id));

  app.get<{ Params: { id: string } }>('/users/:id/history', {
    schema: {
      tags: ['history'], summary: 'Get recent lookup history for an internal user', params: idParams,
      description: 'Authentication is not enabled in this MVP. Protect this endpoint before exposing user data to external API consumers.',
    },
  }, async (request) => dependencies.history.forUser(request.params.id));

  app.get<{ Params: { id: string } }>('/verification/:id', {
    schema: { tags: ['verification'], summary: 'Get a saved verification report', params: idParams },
  }, async (request, reply) => {
    const report = await dependencies.prisma.verificationReport.findUnique({
      where: { lookupHistoryId: request.params.id },
      include: { company: true, lookupHistory: { select: { id: true, query: true, resultStatus: true, createdAt: true } } },
    });
    if (!report) throw new AppError('COMPANY_NOT_FOUND', 'Verification report was not found.');
    reply.header('cache-control', 'no-store');
    return {
      id: report.id,
      lookup: report.lookupHistory,
      company: publicStoredCompany(report.company),
      verification: report.result,
    };
  });
};
