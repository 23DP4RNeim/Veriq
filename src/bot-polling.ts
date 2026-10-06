import { loadConfig } from './app/config.js';
import { createRuntimeServices } from './app/container.js';
import { createPrismaClient } from './infrastructure/database/prisma.js';
import { TelegramAdapter } from './channels/telegram/telegram.adapter.js';

const config = loadConfig();
if (!config.TELEGRAM_BOT_TOKEN) throw new Error('Set TELEGRAM_BOT_TOKEN to start the Telegram bot.');

const prisma = createPrismaClient(config);
const services = createRuntimeServices(config, prisma);
const adapter = new TelegramAdapter(config.TELEGRAM_BOT_TOKEN, config, prisma, services);

try {
  await adapter.startPolling();
} catch (error) {
  console.error(JSON.stringify({ event: 'telegram_polling_failed', errorName: error instanceof Error ? error.name : 'unknown' }));
  process.exitCode = 1;
} finally {
  await adapter.bot.stop();
  await prisma.$disconnect();
}
