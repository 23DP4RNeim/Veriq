import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import { createPrismaClient } from '../infrastructure/database/prisma.js';
import { createRuntimeServices, type RuntimeServices } from './container.js';
import { v1Routes } from '../api/routes/v1.routes.js';
import { AppError } from '../shared/app-error.js';

export interface TelegramWebhookHandler {
  handleWebhook(update: unknown): Promise<'processed' | 'duplicate'>;
}

export interface BuildAppOptions {
  config: AppConfig;
  prisma?: PrismaClient;
  services?: RuntimeServices;
  telegram?: TelegramWebhookHandler;
}

export async function buildApp(options: BuildAppOptions) {
  const prisma = options.prisma ?? createPrismaClient(options.config);
  const ownsPrisma = options.prisma === undefined;
  const app = Fastify({
    logger: {
      level: options.config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-api-key',
          'req.headers.x-telegram-bot-api-secret-token',
          'req.headers.cookie',
        ],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 1024 * 1024,
    genReqId: (request) => {
      const incomingId = request.headers['x-request-id'];
      return typeof incomingId === 'string' && /^[\w.-]{1,100}$/.test(incomingId) ? incomingId : randomUUID();
    },
  });
  const services = options.services ?? createRuntimeServices(options.config, prisma, app.log);

  await app.register(helmet, { contentSecurityPolicy: false });
  const corsOrigins = options.config.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  await app.register(cors, { origin: corsOrigins.length > 0 ? corsOrigins : false, credentials: false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Veriq API', version: '1.0.0', description: 'Company search and structured verification using mock data.' },
      servers: [{ url: '/api/v1' }],
      tags: [
        { name: 'health', description: 'Operational checks' },
        { name: 'companies', description: 'Company lookup' },
        { name: 'verification', description: 'Transparent verification reports' },
        { name: 'history', description: 'Saved lookup history' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.info({ errorCode: error.code, requestId: request.id }, 'Request rejected');
      reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details ?? {}),
        },
      });
      return;
    }

    if ('validation' in error && error.validation) {
      reply.code(400).send({ error: { code: 'INVALID_QUERY', message: 'Request validation failed.', requestId: request.id } });
      return;
    }
    if ('statusCode' in error && error.statusCode === 429) {
      reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Request limit reached. Please try again later.', requestId: request.id } });
      return;
    }

    request.log.error({ errorName: error instanceof Error ? error.name : 'unknown', requestId: request.id }, 'Unhandled request failure');
    reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId: request.id } });
  });

  app.get('/health', async (_request, reply) => {
    const database = await services.companies.health();
    const status = database === 'ok' ? 'ok' : 'degraded';
    if (status !== 'ok') reply.code(503);
    return {
      status,
      database,
      provider: services.companies.providerName,
      telegram: options.config.TELEGRAM_BOT_TOKEN ? 'configured' : 'not_configured',
    };
  });

  await app.register(v1Routes, {
    prefix: '/api/v1',
    companies: services.companies,
    history: services.history,
    rateLimit: services.rateLimit,
    prisma,
    telegramConfigured: Boolean(options.config.TELEGRAM_BOT_TOKEN),
  });

  if (options.telegram) {
    app.post('/api/v1/telegram/webhook', async (request, reply) => {
      const expected = options.config.TELEGRAM_WEBHOOK_SECRET;
      const supplied = request.headers['x-telegram-bot-api-secret-token'];
      if (!expected || supplied !== expected) {
        reply.code(401);
        return { error: { code: 'TELEGRAM_ERROR', message: 'Invalid webhook secret.' } };
      }
      try {
        const result = await options.telegram?.handleWebhook(request.body);
        return { ok: true, result };
      } catch (error) {
        request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Telegram update failed');
        reply.code(500);
        return { error: { code: 'TELEGRAM_ERROR', message: 'Telegram update could not be processed.' } };
      }
    });
  }

  if (ownsPrisma) {
    app.addHook('onClose', async () => prisma.$disconnect());
  }
  return app;
}
