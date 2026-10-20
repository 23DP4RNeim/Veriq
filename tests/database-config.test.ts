import { describe, expect, it } from 'vitest';
import { postgresConnectionOptions } from '../src/infrastructure/database/prisma.js';
import { SUPABASE_POOLER_CA } from '../src/infrastructure/database/supabase-ca.js';

describe('PostgreSQL TLS configuration', () => {
  it('verifies Supabase pooler TLS with the official CA', () => {
    const config = postgresConnectionOptions('postgresql://postgres.project:test@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full');
    expect(config.ssl).toEqual({ ca: SUPABASE_POOLER_CA, rejectUnauthorized: true });
    expect(new URL(config.connectionString!).searchParams.has('sslmode')).toBe(false);
  });
  it('preserves local PostgreSQL connection settings', () => {
    const uri = 'postgresql://postgres:test@localhost:5432/veriq?schema=public';
    expect(postgresConnectionOptions(uri)).toMatchObject({ connectionString: uri, max: 3 });
    expect(postgresConnectionOptions(uri).ssl).toBeUndefined();
  });
  it('does not trust lookalike pooler domains with the Supabase CA', () => {
    const uri = 'postgresql://postgres:test@aws-0-eu-west-1.pooler.supabase.com.example.org:6543/postgres?sslmode=verify-full';
    expect(postgresConnectionOptions(uri).ssl).toBeUndefined();
    expect(postgresConnectionOptions(uri).connectionString).toBe(uri);
  });
});
