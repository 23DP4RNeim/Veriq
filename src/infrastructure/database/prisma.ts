import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../../app/config.js';

export function createPrismaClient(config: AppConfig): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: config.DATABASE_URL } },
    log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}
