import { ProviderUnavailableError } from '../company-data-provider.js';
import type { CompanyRecord } from '../../companies/company.types.js';

type RegistryFields = Pick<CompanyRecord, 'registrationNumber' | 'name' | 'legalForm' | 'status' | 'registrationDate' | 'liquidationDate' | 'legalAddress' | 'postalCode' | 'country' | 'sourceLastUpdated'>;
const CATALOG_URL = 'https://data.gov.lv/dati/api/3/action/package_show?id=uz';
const DATASTORE_URL = 'https://data.gov.lv/dati/api/3/action/datastore_search';

function date(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const parsed = new Date(value.endsWith('Z') ? value : `${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export class UrOpenDataClient {
  constructor(private readonly request: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async findByRegistrationNumber(registrationNumber: string): Promise<RegistryFields | null> {
    let stage = 'catalog';
    let upstreamStatus: number | undefined;
    try {
      // One deadline covers catalog discovery and the filtered DataStore request.
      const signal = AbortSignal.timeout(12000);
      const headers = { accept: 'application/json', 'user-agent': 'Veriq/0.1 (official public company-data lookup)' };
      const catalog = await this.request(CATALOG_URL, { signal, headers });
      upstreamStatus = catalog.status;
      if (!catalog.ok) throw new Error('Catalog unavailable');
      const metadata = await catalog.json() as {
        success?: boolean;
        result?: { license_id?: string; resources?: Array<{ id: string; name: string; datastore_active?: boolean; last_modified?: string }> };
      };
      const resource = metadata.result?.resources?.find((item) => item.name === 'Uzņēmumu reģistra atvērtie dati' && item.datastore_active);
      if (!metadata.success || metadata.result?.license_id !== 'CC0-1.0' || !resource?.id) throw new Error('Official register dataset unavailable');
      const url = new URL(DATASTORE_URL);
      url.searchParams.set('resource_id', resource.id);
      url.searchParams.set('filters', JSON.stringify({ regcode: registrationNumber }));
      url.searchParams.set('limit', '2');
      url.searchParams.set('include_total', 'false');
      stage = 'datastore';
      const response = await this.request(url, { signal, headers });
      upstreamStatus = response.status;
      if (!response.ok) throw new Error('Register request failed');
      const data = await response.json() as { success?: boolean; result?: { records?: Array<Record<string, unknown>> } };
      if (!data.success || !Array.isArray(data.result?.records)) throw new Error('Invalid register response');
      if (data.result.records.length === 0) return null;
      const row = data.result.records[0];
      if (data.result.records.length !== 1 || !row || String(row.regcode) !== registrationNumber || !text(row.name)) throw new Error('Invalid register record');
      // Keep the same Commercial Register scope as the bulk importer.
      if (row.regtype !== 'K') return null;
      const terminated = text(row.terminated);
      const liquidated = Boolean(terminated && text(row.closed) === 'L');
      return {
        registrationNumber,
        name: text(row.name)!,
        legalForm: text(row.type_text),
        status: terminated ? (liquidated ? 'LIQUIDATED' : 'UNKNOWN') : 'ACTIVE',
        registrationDate: date(row.registered),
        liquidationDate: liquidated ? date(terminated) : null,
        legalAddress: text(row.address),
        postalCode: row.index !== null && row.index !== undefined && /^\d{4}$/.test(String(row.index)) ? `LV-${row.index}` : null,
        country: 'Latvia',
        sourceLastUpdated: resource.last_modified ? new Date(`${resource.last_modified.replace(/Z$/, '')}Z`) : null,
      };
    } catch (error) {
      console.warn(JSON.stringify({ event: 'ur_open_data_failed', stage, upstreamStatus, errorName: error instanceof Error ? error.name : 'unknown' }));
      throw new ProviderUnavailableError('Official UR open data is temporarily unavailable.');
    }
  }
}
