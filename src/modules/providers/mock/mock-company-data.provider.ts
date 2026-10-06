import { normalizeCompanyName, normalizeRegistrationNumber } from '../../companies/company.normalization.js';
import type { CompanyRecord, CompanySearchResult } from '../../companies/company.types.js';
import type { CompanyDataProvider } from '../company-data-provider.js';
import { MOCK_COMPANIES } from './companies.data.js';

export class MockCompanyDataProvider implements CompanyDataProvider {
  readonly name = 'mock';

  constructor(private readonly companies: readonly CompanyRecord[] = MOCK_COMPANIES) {}

  async searchByRegistrationNumber(registrationNumber: string): Promise<CompanyRecord | null> {
    const normalized = normalizeRegistrationNumber(registrationNumber);
    return this.companies.find((company) => company.registrationNumber === normalized) ?? null;
  }

  async searchByName(name: string): Promise<CompanySearchResult[]> {
    const normalizedQuery = normalizeCompanyName(name);
    if (!normalizedQuery) return [];

    return this.companies.flatMap((company): CompanySearchResult[] => {
      if (normalizeCompanyName(company.name) === normalizedQuery) {
        return [{ company, matchType: 'current_name' }];
      }
      if (company.previousNames.some((previousName) => normalizeCompanyName(previousName) === normalizedQuery)) {
        return [{ company, matchType: 'previous_name' }];
      }
      return [];
    });
  }

  async getCompanyById(companyId: string): Promise<CompanyRecord | null> {
    return this.companies.find((company) => company.id === companyId) ?? null;
  }
}
