import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { CompanyApplicationService } from '../src/modules/companies/company.service.js';
import { loadConfig } from '../src/app/config.js';
import { WorkerRouter } from '../src/app/worker-router.js';
import { adminRoutes } from '../src/api/routes/admin.routes.js';

async function setup(ready = true) {
  const config = loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: 'test-secret', DATABASE_URL: 'postgresql://localhost/veriq' });
  const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ ready }]), company: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) } };
  const companies = { verify: vi.fn().mockResolvedValue({ status: 'NOT_FOUND', company: null, verification: null }) };
  const router = new WorkerRouter('/api/admin');
  await adminRoutes(router.instance, { config, prisma: prisma as unknown as PrismaClient, companies: companies as unknown as CompanyApplicationService });
  const call = (path: string, body?: unknown, token = 'test-secret') => router.fetch(new Request(`https://veriq.example/api/admin${path}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  }));
  return { call, prisma, companies };
}

describe('Worker admin routes', () => {
  it('rejects invalid tokens before touching the database', async () => {
    const { call, prisma } = await setup();
    expect((await call('/companies', undefined, 'wrong'))?.status).toBe(401);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('authenticates and prevents caching session responses', async () => {
    const { call } = await setup();
    const response = await call('/session');
    expect(await response?.json()).toMatchObject({ authenticated: true, mode: 'token' });
    expect(response?.headers.get('cache-control')).toBe('no-store');
  });
  it('coerces pagination and rejects invalid query values', async () => {
    const { call, prisma } = await setup();
    expect((await call('/companies?page=2&limit=5'))?.status).toBe(200);
    expect(prisma.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 5, take: 5 }));
    expect((await call('/companies?page=invalid'))?.status).toBe(400);
    expect((await call('/companies?limit=101'))?.status).toBe(400);
  });
  it('validates trace requests before executing verification', async () => {
    const { call, companies } = await setup();
    expect((await call('/trace', { query: '' }))?.status).toBe(400);
    expect(companies.verify).not.toHaveBeenCalled();
    const response = await call('/trace', { query: '40103999999' });
    expect(await response?.json()).toMatchObject({ status: 'NOT_FOUND', dataMode: 'database' });
    expect(companies.verify).toHaveBeenCalledWith('40103999999', { platform: 'web' });
  });
  it('refuses in-memory fallback when the production schema is missing', async () => {
    const { call, companies } = await setup(false);
    const response = await call('/trace', { query: '40103999999' });
    expect(response?.status).toBe(503);
    expect(companies.verify).not.toHaveBeenCalled();
  });
  it('refuses in-memory fallback when the production database disconnects', async () => {
    const { call, prisma } = await setup();
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    expect((await call('/companies'))?.status).toBe(503);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });
});
