import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { PoolConfig } from 'pg';
import { SUPABASE_POOLER_CA } from './supabase-ca.js';
import type { AppConfig } from '../../app/config.js';

export function postgresConnectionOptions(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  const poolOptions = { max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 };
  if (url.hostname.endsWith('.pooler.supabase.com')) {
    // pg's connection-string sslmode replaces explicit SSL options, losing the CA.
    // Set TLS explicitly so both the certificate chain and hostname are verified.
    url.searchParams.delete('sslmode');
    return {
      ...poolOptions,
      connectionString: url.toString(),
      ssl: { ca: SUPABASE_POOLER_CA, rejectUnauthorized: true },
    };
  }
  return { ...poolOptions, connectionString: databaseUrl };
}

export function createPrismaClient(config: AppConfig): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(postgresConnectionOptions(config.DATABASE_URL)),
    log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}
