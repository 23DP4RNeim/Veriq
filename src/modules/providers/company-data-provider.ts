import type { CompanyRecord, CompanySearchResult } from '../companies/company.types.js';

export interface CompanyDataProvider {
  readonly name: string;
  searchByRegistrationNumber(registrationNumber: string): Promise<CompanyRecord | null>;
  searchByName(name: string): Promise<CompanySearchResult[]>;
  getCompanyById(companyId: string): Promise<CompanyRecord | null>;
}

export class ProviderUnavailableError extends Error {
  constructor(message = 'Company data provider is temporarily unavailable.') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
