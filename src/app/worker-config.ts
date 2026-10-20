import { loadConfig, type AppConfig } from './config.js';

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  ADMIN_TOKEN?: string;
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  [key: string]: unknown;
}

export class DeploymentConfigurationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DeploymentConfigurationError';
  }
}

export function loadWorkerConfig(env: WorkerEnv): AppConfig {
  const missing: string[] = [];
  if (!env.ADMIN_TOKEN?.trim()) missing.push('ADMIN_TOKEN secret');
  const databaseUrl = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!databaseUrl) missing.push('HYPERDRIVE binding or DATABASE_URL secret');
  if (typeof env.RATE_LIMITER?.limit !== 'function') missing.push('RATE_LIMITER binding');
  if (missing.length) {
    throw new DeploymentConfigurationError('DEPLOYMENT_NOT_CONFIGURED', `Cloudflare Worker is missing: ${missing.join(', ')}. Run npm run cf:setup, then npm run cf:deploy.`);
  }
  let database: URL;
  try {
    database = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('Invalid database protocol');
  } catch {
    throw new DeploymentConfigurationError('INVALID_DATABASE_URL', 'DATABASE_URL must be a PostgreSQL connection URI, not the Supabase project URL or API key.');
  }
  if (!env.HYPERDRIVE && database.hostname.endsWith('.pooler.supabase.com')) {
    throw new DeploymentConfigurationError('HYPERDRIVE_REQUIRED', 'The Supabase pooler requires the HYPERDRIVE binding with its CA certificate on Cloudflare. Run npm run cf:setup, then npm run cf:deploy.');
  }
  const environment = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  try {
    return loadConfig({ ...environment, NODE_ENV: 'production', DATABASE_URL: databaseUrl!, ADMIN_TOKEN: env.ADMIN_TOKEN! });
  } catch {
    throw new DeploymentConfigurationError('INVALID_WORKER_SETTINGS', 'Worker environment settings are invalid. Check provider, rate limits, and Telegram settings; TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_BOT_TOKEN is set.');
  }
}
