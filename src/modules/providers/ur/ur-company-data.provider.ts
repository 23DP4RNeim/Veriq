import type { CompanyDataProvider } from '../company-data-provider.js';
import { ProviderUnavailableError } from '../company-data-provider.js';

export class UrCompanyDataProvider implements CompanyDataProvider {
  readonly name = 'ur';

  async searchByRegistrationNumber(): Promise<null> {
    throw new ProviderUnavailableError('NOT_CONFIGURED: UR access and credentials have not been provided.');
  }

  async searchByName(): Promise<[]> {
    throw new ProviderUnavailableError('NOT_CONFIGURED: UR access and credentials have not been provided.');
  }

  async getCompanyById(): Promise<null> {
    throw new ProviderUnavailableError('NOT_CONFIGURED: UR access and credentials have not been provided.');
  }
}
