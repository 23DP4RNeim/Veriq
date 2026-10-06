import type { CompanyDataProvider } from '../company-data-provider.js';
import { ProviderUnavailableError } from '../company-data-provider.js';

export class FirmasCompanyDataProvider implements CompanyDataProvider {
  readonly name = 'firmas';

  async searchByRegistrationNumber(): Promise<null> {
    throw new ProviderUnavailableError('NOT_CONFIGURED: Firmas.lv commercial access has not been provided.');
  }

  async searchByName(): Promise<[]> {
    throw new ProviderUnavailableError('NOT_CONFIGURED: Firmas.lv commercial access has not been provided.');
  }

  async getCompanyById(): Promise<null> {
    throw new ProviderUnavailableError('NOT_CONFIGURED: Firmas.lv commercial access has not been provided.');
  }
}
