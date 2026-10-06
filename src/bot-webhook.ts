import { loadConfig } from './app/config.js';
import { buildApp } from './app/app.js';
import { createRuntimeServices } from './app/container.js';
import { createPrismaClient } from './infrastructure/database/prisma.js';
import { TelegramAdapter } from './channels/telegram/telegram.adapter.js';

const config = loadConfig();
if (!config.TELEGRAM_BOT_TOKEN) throw new Error('Set TELEGRAM_BOT_TOKEN to start the Telegram bot.');
if (!config.TELEGRAM_WEBHOOK_SECRET) throw new Error('Set TELEGRAM_WEBHOOK_SECRET for webhook mode.');
if (!config.TELEGRAM_WEBHOOK_URL || new URL(config.TELEGRAM_WEBHOOK_URL).protocol !== 'https:') {
  throw new Error('TELEGRAM_WEBHOOK_URL must be an HTTPS URL including /api/v1/telegram/webhook.');
}

const prisma = createPrismaClient(config);
const services = createRuntimeServices(config, prisma);
const telegram = new TelegramAdapter(config.TELEGRAM_BOT_TOKEN, config, prisma, services);
const app = await buildApp({ config, prisma, services, telegram });

try {
  await telegram.setWebhook();
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ port: config.PORT, provider: 'mock' }, 'Veriq webhook server listening');
} catch (error) {
  app.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Webhook server failed to start');
  process.exitCode = 1;
  await app.close();
  await prisma.$disconnect();
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Shutting down webhook server');
  await app.close();
  await prisma.$disconnect();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
