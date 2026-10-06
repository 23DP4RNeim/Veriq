import { loadConfig } from './app/config.js';
import { buildApp } from './app/app.js';

const config = loadConfig();
const app = await buildApp({ config });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ port: config.PORT, provider: 'mock' }, 'Veriq API listening');
} catch (error) {
  app.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'API failed to start');
  await app.close();
  process.exitCode = 1;
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
