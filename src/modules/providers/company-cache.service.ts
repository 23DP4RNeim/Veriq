import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { CompanyDataProvider } from './company-data-provider.js';
import type { CompanyRecord, CompanySearchResult } from '../companies/company.types.js';

export class CompanyCacheService {
  constructor(private readonly prisma: PrismaClient, private readonly ttlSeconds = 3600) {}

  async get<T>(provider: string, query: string): Promise<T | null> {
    const entry = await this.prisma.companyCacheEntry.findUnique({ where: { cacheKey: this.key(provider, query) } });
    if (!entry) return null;
    if (entry.expiresAt.getTime() <= Date.now()) {
      await this.prisma.companyCacheEntry.delete({ where: { cacheKey: entry.cacheKey } });
      return null;
    }
    return entry.result as T;
  }

  async set(provider: string, query: string, result: unknown): Promise<void> {
    const now = new Date();
    const jsonValue = result === null ? Prisma.JsonNull : JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
    await this.prisma.companyCacheEntry.upsert({
      where: { cacheKey: this.key(provider, query) },
      create: {
        cacheKey: this.key(provider, query), provider, query, result: jsonValue,
        retrievedAt: now, expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
      },
      update: {
        result: jsonValue, retrievedAt: now, expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
      },
    });
  }

  private key(provider: string, query: string): string {
    return createHash('sha256').update(`${provider}:${query}`).digest('hex');
  }
}

export class CachedCompanyDataProvider implements CompanyDataProvider {
  readonly name: string;

  constructor(
    private readonly provider: CompanyDataProvider,
    private readonly cache: CompanyCacheService,
    private readonly onCacheError: (error: unknown) => void = () => undefined,
  ) {
    this.name = provider.name;
  }

  async searchByRegistrationNumber(registrationNumber: string): Promise<CompanyRecord | null> {
    return this.cached(`registration:${registrationNumber}`, () => this.provider.searchByRegistrationNumber(registrationNumber));
  }

  async searchByName(name: string): Promise<CompanySearchResult[]> {
    return this.cached(`name:${name}`, () => this.provider.searchByName(name));
  }

  async getCompanyById(companyId: string): Promise<CompanyRecord | null> {
    return this.cached(`id:${companyId}`, () => this.provider.getCompanyById(companyId));
  }

  private async cached<T>(query: string, fetch: () => Promise<T>): Promise<T> {
    try {
      const cachedResult = await this.cache.get<T>(this.name, query);
      if (cachedResult !== null) return restoreDates(cachedResult);
    } catch (error) {
      this.onCacheError(error);
    }

    const result = await fetch();
    try {
      await this.cache.set(this.name, query, result);
    } catch (error) {
      this.onCacheError(error);
    }
    return result;
  }
}

function restoreDates<T>(value: T): T {
  const dateFields = new Set(["registrationDate", "liquidationDate", "lastAnnualReportDate", "sourceLastUpdated", "createdAt", "updatedAt", "checkedAt", "retrievedAt", "expiresAt"]);
  const visit = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (typeof candidate !== "object" || candidate === null) return candidate;
    return Object.fromEntries(Object.entries(candidate).map(([key, item]) => dateFields.has(key) && typeof item === "string" ? [key, new Date(item)] : [key, visit(item)]));
  };
  return visit(value) as T;
}
