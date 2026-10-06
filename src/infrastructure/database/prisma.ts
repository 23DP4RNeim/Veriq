import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../../app/config.js';

export function createPrismaClient(config: AppConfig): PrismaClient {
  return new PrismaClient({
    log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}
