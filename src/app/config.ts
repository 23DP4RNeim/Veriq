import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/veriq?schema=public'),
  COMPANY_PROVIDER: z.literal('mock').default('mock'),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(''),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional().or(z.literal('')).default(''),
  ADMIN_TOKEN: z.string().optional().default(''),
  WHATSAPP_ENABLED: z.stringbool().default(false),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
  RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default(''),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.TELEGRAM_WEBHOOK_SECRET && parsed.data.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is required when Telegram is configured in production.');
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN is required in production.');
  }
  return parsed.data;
}
