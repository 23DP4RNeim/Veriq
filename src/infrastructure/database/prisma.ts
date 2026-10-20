import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../../app/config.js';

export function createPrismaClient(config: AppConfig): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 }),
    log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}
