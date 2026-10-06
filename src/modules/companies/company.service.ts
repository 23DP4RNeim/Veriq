import { createHash } from 'node:crypto';
import { Prisma, type Platform, type PrismaClient } from '@prisma/client';
import type { AppErrorCode } from '../../shared/app-error.js';
import { AppError } from '../../shared/app-error.js';
import { identifyQuery } from './company.normalization.js';
import type { CompanyRecord, CompanySearchResult } from './company.types.js';
import { CompanyProviderGateway } from '../providers/company-provider.gateway.js';
import type { CompanyDataProvider } from '../providers/company-data-provider.js';
import type { VerificationEngine } from '../verification/verification.engine.js';
import type { VerificationResult } from '../verification/verification.types.js';

export interface LookupActor {
  platform: Platform;
  userId?: string;
}

export interface CompanyMatchView {
  id: string;
  registrationNumber: string;
  name: string;
  status: string;
  matchType?: string;
}

export type CompanySearchOutcome =
  | { status: 'MATCH'; matches: CompanyMatchView[] }
  | { status: 'MULTIPLE_MATCHES'; matches: CompanyMatchView[] }
  | { status: 'NOT_FOUND'; matches: [] }
  | { status: 'DATA_UNAVAILABLE'; matches: []; message: string };

export type CompanyVerificationOutcome =
  | { status: 'VERIFIED' | 'WARNING' | 'NOT_VERIFIED'; company: CompanyRecord; verification: VerificationResult; source: string }
  | { status: 'NOT_FOUND' | 'DATA_UNAVAILABLE'; company: null; verification: VerificationResult; source: string }
  | { status: 'MULTIPLE_MATCHES'; company: null; verification: null; matches: CompanyMatchView[]; source: string };

export class CompanyApplicationService {
  private readonly gateway: CompanyProviderGateway;

  constructor(
    private readonly prisma: PrismaClient,
    provider: CompanyDataProvider,
    private readonly engine: VerificationEngine,
    log: (level: 'info' | 'warn', message: string, fields: Record<string, unknown>) => void = () => undefined,
  ) {
    this.gateway = new CompanyProviderGateway(provider, async (event) => {
      await this.prisma.providerRequest.create({
        data: {
          providerName: event.provider,
          sourceRecordId: event.companyId,
          queryHash: event.queryHash,
          status: event.status,
          durationMs: event.durationMs,
          errorCode: event.errorCode,
        },
      });
    }, log);
  }

  get providerName(): string {
    return this.gateway.name;
  }

  async search(query: string, actor?: LookupActor): Promise<CompanySearchOutcome> {
    const matches = await this.findMatches(query);
    if (matches === null) {
      await this.saveLookup(query, 'DATA_UNAVAILABLE', null, actor, 'COMPANY_SEARCH');
      return { status: 'DATA_UNAVAILABLE', matches: [], message: 'Company verification could not be completed because the data source is temporarily unavailable.' };
    }
    if (matches.length === 0) {
      await this.saveLookup(query, 'NOT_FOUND', null, actor, 'COMPANY_SEARCH');
      return { status: 'NOT_FOUND', matches: [] };
    }
    const views = matches.map((match) => this.toMatchView(match.company, match.matchType));
    await this.saveLookup(query, matches.length === 1 ? 'MATCH' : 'MULTIPLE_MATCHES', matches.length === 1 ? matches[0]?.company ?? null : null, actor, 'COMPANY_SEARCH');
    return { status: matches.length === 1 ? 'MATCH' : 'MULTIPLE_MATCHES', matches: views };
  }

  async verify(query: string, actor?: LookupActor, expectedName?: string): Promise<CompanyVerificationOutcome> {
    const matches = await this.findMatches(query);
    if (matches === null) {
      const verification = this.engine.dataUnavailable();
      await this.saveLookup(query, verification.status, null, actor, 'COMPANY_VERIFICATION');
      return { status: 'DATA_UNAVAILABLE', company: null, verification, source: this.providerName };
    }
    if (matches.length === 0) {
      const verification = this.engine.notFound();
      await this.saveLookup(query, verification.status, null, actor, 'COMPANY_VERIFICATION');
      return { status: 'NOT_FOUND', company: null, verification, source: this.providerName };
    }
    if (matches.length > 1) {
      const views = matches.map((match) => this.toMatchView(match.company, match.matchType));
      await this.saveLookup(query, 'MULTIPLE_MATCHES', null, actor, 'COMPANY_VERIFICATION');
      return { status: 'MULTIPLE_MATCHES', company: null, verification: null, matches: views, source: this.providerName };
    }

    const match = matches[0];
    if (!match) throw new AppError('INTERNAL_ERROR', 'Company lookup returned an invalid result.');
    const nameQuery = expectedName ?? (identifyQuery(query).kind === 'company_name' ? query : undefined);
    const verification = this.engine.evaluate(match.company, nameQuery ? { query: nameQuery, queryKind: 'company_name' } : { queryKind: 'registration_number' });
    await this.saveLookup(query, verification.status, match.company, actor, 'COMPANY_VERIFICATION', verification);
    if (verification.status !== 'VERIFIED' && verification.status !== 'WARNING' && verification.status !== 'NOT_VERIFIED') {
      throw new AppError('INTERNAL_ERROR', 'Verification engine returned an unexpected result for a company.');
    }
    return { status: verification.status, company: match.company, verification, source: match.company.dataSource };
  }

  async verifyByCompanyId(companyId: string, actor?: LookupActor, query = companyId): Promise<CompanyVerificationOutcome> {
    let company: CompanyRecord | null;
    try {
      company = await this.gateway.getCompanyById(companyId);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'PROVIDER_UNAVAILABLE') throw error;
      const verification = this.engine.dataUnavailable();
      await this.saveLookup(query, verification.status, null, actor, 'COMPANY_VERIFICATION');
      return { status: 'DATA_UNAVAILABLE', company: null, verification, source: this.providerName };
    }
    if (!company) {
      const verification = this.engine.notFound();
      await this.saveLookup(query, verification.status, null, actor, 'COMPANY_VERIFICATION');
      return { status: 'NOT_FOUND', company: null, verification, source: this.providerName };
    }
    const verification = this.engine.evaluate(company, { queryKind: 'registration_number' });
    await this.saveLookup(query, verification.status, company, actor, 'COMPANY_VERIFICATION', verification);
    if (verification.status !== 'VERIFIED' && verification.status !== 'WARNING' && verification.status !== 'NOT_VERIFIED') {
      throw new AppError('INTERNAL_ERROR', 'Verification engine returned an unexpected result for a company.');
    }
    return { status: verification.status, company, verification, source: company.dataSource };
  }

  async getCompanyById(companyId: string): Promise<CompanyRecord | null> {
    return this.gateway.getCompanyById(companyId);
  }

  async health(): Promise<'ok' | 'error'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async findMatches(query: string): Promise<CompanySearchResult[] | null> {
    const identified = identifyQuery(query);
    try {
      if (identified.kind === 'registration_number') {
        const company = await this.gateway.searchByRegistrationNumber(identified.normalized);
        return company ? [{ company, matchType: 'registration_number' }] : [];
      }
      return this.gateway.searchByName(query);
    } catch (error) {
      if (error instanceof AppError && (error.code === 'PROVIDER_UNAVAILABLE' || error.code === 'PROVIDER_TIMEOUT')) return null;
      throw error;
    }
  }

  private async saveLookup(
    query: string,
    resultStatus: string,
    company: CompanyRecord | null,
    actor: LookupActor | undefined,
    eventType: string,
    verification?: VerificationResult,
  ): Promise<void> {
    if (company) await this.ensureCompanyStored(company);
    const safeQuery = query.trim().slice(0, 200);
    const queryHash = createHash('sha256').update(query).digest('hex');
    await this.prisma.$transaction(async (transaction) => {
      const lookup = await transaction.lookupHistory.create({
        data: {
          query: safeQuery,
          resultStatus,
          platform: actor?.platform ?? 'api',
          ...(actor?.userId ? { userId: actor.userId } : {}),
          ...(company ? { companyId: company.id } : {}),
        },
      });
      if (company && verification) {
        await transaction.verificationReport.create({
          data: {
            lookupHistoryId: lookup.id,
            companyId: company.id,
            result: JSON.parse(JSON.stringify(verification)) as Prisma.InputJsonValue,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          eventType,
          platform: actor?.platform ?? 'api',
          metadata: { resultStatus, queryHash } as Prisma.InputJsonValue,
          ...(actor?.userId ? { userId: actor.userId } : {}),
          ...(company ? { companyId: company.id } : {}),
        },
      });
    });
  }

  private async ensureCompanyStored(company: CompanyRecord): Promise<void> {
    const json = (value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =>
      value === null ? Prisma.DbNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    await this.prisma.company.upsert({
      where: { registrationNumber: company.registrationNumber },
      create: {
        id: company.id,
        registrationNumber: company.registrationNumber,
        name: company.name,
        previousNames: company.previousNames,
        legalForm: company.legalForm,
        status: company.status,
        registrationDate: company.registrationDate,
        liquidationDate: company.liquidationDate,
        legalAddress: company.legalAddress,
        postalCode: company.postalCode,
        city: company.city,
        country: company.country,
        vatRegistered: company.vatRegistered,
        vatNumber: company.vatNumber,
        industryCode: company.industryCode,
        industryName: company.industryName,
        boardMembers: json(company.boardMembers),
        shareholders: json(company.shareholders),
        beneficialOwners: json(company.beneficialOwners),
        annualReportAvailable: company.annualReportAvailable,
        lastAnnualReportDate: company.lastAnnualReportDate,
        revenue: company.revenue,
        profit: company.profit,
        employeeCount: company.employeeCount,
        insolvencyStatus: company.insolvencyStatus,
        sanctionsStatus: company.sanctionsStatus,
        dataSource: company.dataSource,
        sourceLastUpdated: company.sourceLastUpdated,
      },
      update: {},
    });
  }

  private toMatchView(company: CompanyRecord, matchType?: string): CompanyMatchView {
    return {
      id: company.id,
      registrationNumber: company.registrationNumber,
      name: company.name,
      status: company.status,
      ...(matchType ? { matchType } : {}),
    };
  }
}

export function errorCodeForPersistence(error: unknown): AppErrorCode {
  return error instanceof AppError ? error.code : 'DATABASE_ERROR';
}
