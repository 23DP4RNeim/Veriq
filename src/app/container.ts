import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config.js';
import { CompanyApplicationService } from '../modules/companies/company.service.js';
import { CompanyCacheService, CachedCompanyDataProvider } from '../modules/providers/company-cache.service.js';
import { MockCompanyDataProvider } from '../modules/providers/mock/mock-company-data.provider.js';
import { VerificationEngine } from '../modules/verification/verification.engine.js';
import { HistoryService, UserService } from '../modules/users/user.service.js';
import { PrismaRateLimitStore, RateLimitService } from '../modules/rate-limit/rate-limit.service.js';

export interface RuntimeServices {
  companies: CompanyApplicationService;
  history: HistoryService;
  users: UserService;
  rateLimit: RateLimitService;
}

export function createRuntimeServices(
  config: AppConfig,
  prisma: PrismaClient,
  logger?: FastifyBaseLogger,
): RuntimeServices {
  const baseProvider = new MockCompanyDataProvider();
  const cache = new CompanyCacheService(prisma);
  const provider = new CachedCompanyDataProvider(baseProvider, cache, (error) => {
    logger?.warn({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Company cache operation failed');
  });
  const companies = new CompanyApplicationService(
    prisma,
    provider,
    new VerificationEngine(),
    (level, message, fields) => {
      if (level === 'warn') logger?.warn(fields, message);
      else logger?.info(fields, message);
    },
  );
  return {
    companies,
    history: new HistoryService(prisma),
    users: new UserService(prisma),
    rateLimit: new RateLimitService(new PrismaRateLimitStore(prisma), config.RATE_LIMIT_REQUESTS, config.RATE_LIMIT_WINDOW_SECONDS),
  };
}
