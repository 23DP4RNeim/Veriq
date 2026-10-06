import { createHash } from 'node:crypto';
import { AppError } from '../../shared/app-error.js';
import type { CompanyRecord, CompanySearchResult } from '../companies/company.types.js';
import type { CompanyDataProvider } from './company-data-provider.js';
import { ProviderUnavailableError } from './company-data-provider.js';

export interface ProviderRequestEvent {
  provider: string;
  operation: string;
  queryHash: string;
  durationMs: number;
  status: 'success' | 'error';
  companyId: string | null;
  errorCode: string | null;
}

export type ProviderRequestObserver = (event: ProviderRequestEvent) => Promise<void>;

export class CompanyProviderGateway {
  constructor(
    private readonly provider: CompanyDataProvider,
    private readonly observe: ProviderRequestObserver = async () => undefined,
    private readonly log: (level: 'info' | 'warn', message: string, fields: Record<string, unknown>) => void = () => undefined,
  ) {}

  get name(): string {
    return this.provider.name;
  }

  searchByRegistrationNumber(registrationNumber: string): Promise<CompanyRecord | null> {
    return this.call('search_by_registration_number', registrationNumber, () => this.provider.searchByRegistrationNumber(registrationNumber));
  }

  searchByName(name: string): Promise<CompanySearchResult[]> {
    return this.call('search_by_name', name, () => this.provider.searchByName(name));
  }

  getCompanyById(companyId: string): Promise<CompanyRecord | null> {
    return this.call('get_company_by_id', companyId, () => this.provider.getCompanyById(companyId));
  }

  private async call<T>(operation: string, query: string, request: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const queryHash = createHash('sha256').update(query).digest('hex');
    try {
      const result = await request();
      const companyId = this.companyId(result);
      await this.record({
        provider: this.provider.name, operation, queryHash, durationMs: Date.now() - startedAt,
        status: 'success', companyId, errorCode: null,
      });
      return result;
    } catch (error) {
      const isExpectedUnavailable = error instanceof ProviderUnavailableError;
      await this.record({
        provider: this.provider.name, operation, queryHash, durationMs: Date.now() - startedAt,
        status: 'error', companyId: null, errorCode: isExpectedUnavailable ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
      });
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'Company verification could not be completed because the data source is temporarily unavailable.',
      );
    }
  }

  private async record(event: ProviderRequestEvent): Promise<void> {
    this.log(event.status === 'success' ? 'info' : 'warn', 'Company provider request completed', {
      provider: event.provider,
      operation: event.operation,
      durationMs: event.durationMs,
      status: event.status,
      errorCode: event.errorCode,
    });
    try {
      await this.observe(event);
    } catch (error) {
      this.log('warn', 'Provider request telemetry could not be persisted', { errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }

  private companyId(result: unknown): string | null {
    if (typeof result !== 'object' || result === null) return null;
    if ('id' in result && typeof result.id === 'string') return result.id;
    if ('company' in result && typeof result.company === 'object' && result.company !== null && 'id' in result.company && typeof result.company.id === 'string') {
      return result.company.id;
    }
    return null;
  }
}
