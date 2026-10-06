import { describe, expect, it } from 'vitest';
import { MockCompanyDataProvider } from '../src/modules/providers/mock/mock-company-data.provider.js';
import { CompanyProviderGateway } from '../src/modules/providers/company-provider.gateway.js';
import { ProviderUnavailableError, type CompanyDataProvider } from '../src/modules/providers/company-data-provider.js';
import { AppError } from '../src/shared/app-error.js';

describe('MockCompanyDataProvider', () => {
  const provider = new MockCompanyDataProvider();

  it('looks up registration numbers after normalization', async () => {
    const company = await provider.searchByRegistrationNumber('LV 4010 399 9999');
    expect(company?.name).toBe('SIA Baltic Example');
  });

  it('normalizes company names and includes historical names', async () => {
    const matches = await provider.searchByName(' SIA   Greenfield ');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchType).toBe('previous_name');
  });

  it('returns multiple possible matches and a not-found result', async () => {
    expect(await provider.searchByName('SIA Example Labs')).toHaveLength(2);
    expect(await provider.searchByRegistrationNumber('40200000000')).toBeNull();
  });
});

describe('CompanyProviderGateway', () => {
  it('converts provider failures into a safe unavailable error', async () => {
    const failedProvider: CompanyDataProvider = {
      name: 'mock-failure',
      searchByRegistrationNumber: async () => { throw new ProviderUnavailableError(); },
      searchByName: async () => { throw new ProviderUnavailableError(); },
      getCompanyById: async () => { throw new ProviderUnavailableError(); },
    };
    const gateway = new CompanyProviderGateway(failedProvider);
    await expect(gateway.searchByRegistrationNumber('40103999999')).rejects.toMatchObject({
      constructor: AppError,
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});
