import { describe, expect, it } from 'vitest';
import { DeploymentConfigurationError, loadWorkerConfig, type WorkerEnv } from '../src/app/worker-config.js';
import worker from '../src/worker.js';

function environment(): WorkerEnv {
  return {
    ASSETS: { fetch: async () => new Response('admin') },
    ADMIN_TOKEN: 'private-admin-token',
    DATABASE_URL: 'postgresql://postgres:private-password@localhost:5432/veriq',
    RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

describe('Worker deployment configuration', () => {
  it('identifies missing secrets and bindings without exposing values', () => {
    const env = environment();
    delete env.ADMIN_TOKEN;
    delete env.RATE_LIMITER;
    try {
      loadWorkerConfig(env);
      expect.fail('Expected deployment configuration failure');
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentConfigurationError);
      expect((error as Error).message).toContain('ADMIN_TOKEN');
      expect((error as Error).message).toContain('RATE_LIMITER');
      expect((error as Error).message).not.toContain('private-password');
    }
  });
  it('rejects Supabase API URLs used as database URLs', () => {
    expect(() => loadWorkerConfig({ ...environment(), DATABASE_URL: 'https://example.supabase.co' })).toThrow('PostgreSQL connection URI');
  });
  it('identifies the Hyperdrive requirement for the Supabase shared pooler', () => {
    expect(() => loadWorkerConfig({ ...environment(), DATABASE_URL: 'postgresql://postgres.project:password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres' })).toThrow('HYPERDRIVE binding');
  });
  it('uses Hyperdrive without requiring a separate database secret', () => {
    const env = environment();
    delete env.DATABASE_URL;
    env.HYPERDRIVE = { connectionString: 'postgresql://hyperdrive:password@127.0.0.1:5432/postgres' };
    expect(loadWorkerConfig(env).DATABASE_URL).toBe(env.HYPERDRIVE.connectionString);
    expect(loadWorkerConfig(env).NODE_ENV).toBe('production');
  });
  it('returns a specific deployment error through the HTTP handler', async () => {
    const env = environment();
    delete env.ADMIN_TOKEN;
    const response = await worker.fetch(new Request('https://veriq.example/api/admin/session'), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'DEPLOYMENT_NOT_CONFIGURED' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('serves the admin shell when secrets are missing so errors remain visible', async () => {
    const env = environment();
    delete env.ADMIN_TOKEN;
    const response = await worker.fetch(new Request('https://veriq.example/admin'), env);
    expect(response.status).toBe(200);
  });
});
