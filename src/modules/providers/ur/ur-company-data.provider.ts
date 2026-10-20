import { Prisma, type PrismaClient } from '@prisma/client';
import { namesMatch, normalizeCompanyName, normalizeRegistrationNumber } from '../../companies/company.normalization.js';
import type { CompanyPerson, CompanyRecord, CompanySearchResult } from '../../companies/company.types.js';
import { UrOpenDataClient } from './ur-open-data.client.js';
import type { CompanyDataProvider } from '../company-data-provider.js';

export const UR_OPEN_DATA_SOURCE = 'Latvian Register of Enterprises Open Data (CC0)';

function personList(value: Prisma.JsonValue | null): CompanyPerson[] | null {
  return Array.isArray(value) ? value as unknown as CompanyPerson[] : null;
}

function companyRecord(row: Awaited<ReturnType<PrismaClient['company']['findUnique']>>): CompanyRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    registrationNumber: row.registrationNumber,
    name: row.name,
    previousNames: row.previousNames,
    legalForm: row.legalForm,
    status: row.status,
    registrationDate: row.registrationDate,
    liquidationDate: row.liquidationDate,
    legalAddress: row.legalAddress,
    postalCode: row.postalCode,
    city: row.city,
    country: row.country,
    vatRegistered: row.vatRegistered,
    vatNumber: row.vatNumber,
    industryCode: row.industryCode,
    industryName: row.industryName,
    boardMembers: personList(row.boardMembers),
    shareholders: personList(row.shareholders),
    beneficialOwners: personList(row.beneficialOwners),
    annualReportAvailable: row.annualReportAvailable,
    lastAnnualReportDate: row.lastAnnualReportDate,
    revenue: row.revenue,
    profit: row.profit,
    employeeCount: row.employeeCount,
    totalAssets: row.totalAssets,
    equity: row.equity,
    totalLiabilities: row.totalLiabilities,
    financialYear: row.financialYear,
    financialCurrency: row.financialCurrency,
    paidUpCapital: row.paidUpCapital,
    capitalCurrency: row.capitalCurrency,
    insolvencyStatus: row.insolvencyStatus,
    sanctionsStatus: row.sanctionsStatus,
    dataSource: row.dataSource,
    sourceLastUpdated: row.sourceLastUpdated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class UrCompanyDataProvider implements CompanyDataProvider {
  readonly name = 'ur-open-data';

  constructor(private readonly prisma: PrismaClient, private readonly openData = new UrOpenDataClient()) {}

  async searchByRegistrationNumber(registrationNumber: string): Promise<CompanyRecord | null> {
    const normalized = normalizeRegistrationNumber(registrationNumber);
    const existing = await this.prisma.company.findUnique({ where: { registrationNumber: normalized } });
    if (existing?.dataSource === UR_OPEN_DATA_SOURCE) return companyRecord(existing);
    const fields = await this.openData.findByRegistrationNumber(normalized);
    if (!fields) return null;
    // A number miss can be resolved without downloading the full registry.
    // Never carry fictional/provider-specific risk or financial fields into a UR record.
    const unsupportedFields = {
      previousNames: [], city: null, vatRegistered: null, vatNumber: null,
      industryCode: null, industryName: null, boardMembers: Prisma.DbNull, shareholders: Prisma.DbNull,
      beneficialOwners: Prisma.DbNull, annualReportAvailable: null, lastAnnualReportDate: null,
      revenue: null, profit: null, employeeCount: null, totalAssets: null, equity: null,
      totalLiabilities: null, financialYear: null, financialCurrency: null,
      paidUpCapital: null, capitalCurrency: null,
      insolvencyStatus: 'UNKNOWN' as const, sanctionsStatus: 'UNKNOWN' as const,
    };
    const row = await this.prisma.company.upsert({
      where: { registrationNumber: normalized },
      create: { ...unsupportedFields, ...fields, dataSource: UR_OPEN_DATA_SOURCE },
      update: { ...(existing ? unsupportedFields : {}), ...fields, dataSource: UR_OPEN_DATA_SOURCE },
    });
    return companyRecord(row);
  }

  async searchByName(name: string): Promise<CompanySearchResult[]> {
    const normalized = normalizeCompanyName(name);
    if (!normalized) return [];
    const searchTerm = normalized;
    const rows = await this.prisma.company.findMany({
      where: {
        dataSource: UR_OPEN_DATA_SOURCE,
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { previousNames: { has: name.trim() } },
        ],
      },
      take: 2500,
    });
    return rows.flatMap((row): CompanySearchResult[] => {
      const company = companyRecord(row);
      if (!company || !namesMatch(name, company)) return [];
      return [{ company, matchType: normalizeCompanyName(company.name) === normalized ? 'current_name' : 'previous_name' }];
    });
  }

  async getCompanyById(companyId: string): Promise<CompanyRecord | null> {
    const row = await this.prisma.company.findFirst({
      where: { id: companyId, dataSource: UR_OPEN_DATA_SOURCE },
    });
    return companyRecord(row);
  }
}
