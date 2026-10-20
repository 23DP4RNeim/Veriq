import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { UrOpenDataClient } from '../src/modules/providers/ur/ur-open-data.client.js';
import { UrCompanyDataProvider, UR_OPEN_DATA_SOURCE } from '../src/modules/providers/ur/ur-company-data.provider.js';
import { ProviderUnavailableError } from '../src/modules/providers/company-data-provider.js';
import { MOCK_COMPANIES } from '../src/modules/providers/mock/companies.data.js';

const registryRow = {
  regcode: 40103867145, name: 'AS "VIADA Baltija"', regtype: 'K', type_text: 'Akciju sabiedrība',
  registered: '2015-02-03T00:00:00', terminated: null, closed: ' ', address: 'Rīga, Alīses iela 3', index: 1083,
};
function fixture(records: unknown[] = [registryRow]) {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ success: true, result: { license_id: 'CC0-1.0', resources: [{ id: 'registry-resource', name: 'Uzņēmumu reģistra atvērtie dati', datastore_active: true, last_modified: '2026-10-19T20:25:06.745623' }] } }))
    .mockResolvedValueOnce(Response.json({ success: true, result: { records } }));
  return { request, client: new UrOpenDataClient(request) };
}

describe('official UR public DataStore', () => {
  it('calls native fetch with the global receiver required by Workers', async () => {
    const { request } = fixture();
    vi.stubGlobal('fetch', function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return request(...args);
    });
    try {
      const company = await new UrOpenDataClient().findByRegistrationNumber('40103867145');
      expect(company?.name).toBe('AS "VIADA Baltija"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('uses a filtered official dataset query and maps the registration data', async () => {
    const { request, client } = fixture();
    const company = await client.findByRegistrationNumber('40103867145');
    expect(company).toMatchObject({ registrationNumber: '40103867145', name: 'AS "VIADA Baltija"', status: 'ACTIVE', postalCode: 'LV-1083', legalForm: 'Akciju sabiedrība' });
    expect(company?.registrationDate).toEqual(new Date('2015-02-03T00:00:00Z'));
    expect(company?.sourceLastUpdated?.toISOString()).toBe('2026-10-19T20:25:06.745Z');
    const url = new URL(String(request.mock.calls[1]?.[0]));
    expect(url.hostname).toBe('data.gov.lv');
    expect(JSON.parse(url.searchParams.get('filters')!)).toEqual({ regcode: '40103867145' });
    expect(url.searchParams.get('resource_id')).toBe('registry-resource');
  });
  it('returns not-found only for a successful empty lookup', async () => {
    expect(await fixture([]).client.findByRegistrationNumber('40103867145')).toBeNull();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status: 503 }));
    await expect(new UrOpenDataClient(request).findByRegistrationNumber('40103867145')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
  it('rejects mismatched or ambiguous results', async () => {
    await expect(fixture([{ ...registryRow, regcode: 40103999999 }]).client.findByRegistrationNumber('40103867145')).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(fixture([registryRow, registryRow]).client.findByRegistrationNumber('40103867145')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
  it('maps a recorded liquidation without inventing a clean risk result', async () => {
    const company = await fixture([{ ...registryRow, terminated: '2025-12-31T00:00:00', closed: 'L' }]).client.findByRegistrationNumber('40103867145');
    expect(company?.status).toBe('LIQUIDATED');
    expect(company?.liquidationDate).toEqual(new Date('2025-12-31T00:00:00Z'));
    expect(company).not.toHaveProperty('vatRegistered');
    expect(company).not.toHaveProperty('sanctionsStatus');
  });
});

describe('UR provider on-demand registration lookup', () => {
  it('normalizes LV input, saves the official result, and leaves unsupported fields unknown', async () => {
    const { client } = fixture();
    const find = vi.spyOn(client, 'findByRegistrationNumber');
    const database = { company: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(async ({ create }) => ({ id: 'company-id', ...create })),
    } };
    const provider = new UrCompanyDataProvider(database as unknown as PrismaClient, client);
    const company = await provider.searchByRegistrationNumber('LV40103867145');
    expect(find).toHaveBeenCalledWith('40103867145');
    expect(company).toMatchObject({ name: 'AS "VIADA Baltija"', dataSource: UR_OPEN_DATA_SOURCE, vatRegistered: null, annualReportAvailable: null, sanctionsStatus: 'UNKNOWN', insolvencyStatus: 'UNKNOWN' });
  });
  it('preserves previously imported enrichment in the official mirror', async () => {
    const { client } = fixture();
    const find = vi.spyOn(client, 'findByRegistrationNumber');
    const database = { company: { findUnique: vi.fn().mockResolvedValue({ ...MOCK_COMPANIES[0], dataSource: UR_OPEN_DATA_SOURCE, revenue: 1234 }) } };
    const provider = new UrCompanyDataProvider(database as unknown as PrismaClient, client);
    expect((await provider.searchByRegistrationNumber('LV40103867145'))?.revenue).toBe(1234);
    expect(find).not.toHaveBeenCalled();
  });
  it('clears fictional enrichment when replacing a mock record with official data', async () => {
    const { client } = fixture();
    const database = { company: {
      findUnique: vi.fn().mockResolvedValue({ ...MOCK_COMPANIES[0], dataSource: 'Mock Provider' }),
      upsert: vi.fn().mockImplementation(async ({ update }) => ({ id: 'company-id', ...update })),
    } };
    const provider = new UrCompanyDataProvider(database as unknown as PrismaClient, client);
    await provider.searchByRegistrationNumber('40103867145');
    expect(database.company.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ revenue: null, vatRegistered: null, sanctionsStatus: 'UNKNOWN', previousNames: [] }) }));
  });
});
