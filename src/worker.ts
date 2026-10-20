import { validAdminToken } from './shared/admin-auth.js';
import { loadConfig } from './app/config.js';
import { createRuntimeServices } from './app/container.js';
import { createPrismaClient } from './infrastructure/database/prisma.js';
import { adminRoutes } from './api/routes/admin.routes.js';
import { v1Routes } from './api/routes/v1.routes.js';
import { TelegramAdapter } from './channels/telegram/telegram.adapter.js';
import { WorkerRouter } from './app/worker-router.js';

interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DATABASE_URL: string;
  HYPERDRIVE?: { connectionString: string };
  ADMIN_TOKEN: string;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  [key: string]: unknown;
}

async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (['/', '/admin', '/admin/', '/admin.html'].includes(url.pathname)) {
    // Cloudflare canonicalizes admin.html to /admin. Fetch /admin directly to avoid a redirect loop.
    const asset = await env.ASSETS.fetch(new Request(new URL('/admin', url), request));
    const response = new Response(asset.body, asset);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'same-origin');
    response.headers.set('X-Frame-Options', 'DENY');
    return response;
  }
  const limit = await env.RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
  if (!limit.success) return Response.json({ error: { code: 'RATE_LIMITED', message: 'Request limit reached.' } }, { status: 429, headers: { 'retry-after': '60' } });
  const environment = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const config = loadConfig({ ...environment, NODE_ENV: 'production', DATABASE_URL: env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? '', ADMIN_TOKEN: env.ADMIN_TOKEN ?? '' });
  const publicRoute = ['/health', '/api/v1/health', '/api/v1/telegram/webhook'].includes(url.pathname);
  if (!publicRoute && !validAdminToken(request.headers.get('authorization') ?? undefined, config.ADMIN_TOKEN)) {
    return Response.json({ error: { code: 'ADMIN_ACCESS_DENIED', message: 'Admin token required.' } }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  if (Number(request.headers.get('content-length')) > 1024 * 1024) return new Response('Payload too large', { status: 413 });
  const prisma = createPrismaClient(config);
  try {
    const admin = new WorkerRouter('/api/admin');
    const api = new WorkerRouter('/api/v1');
    const services = createRuntimeServices(config, prisma, admin.logger);
    if (url.pathname === '/api/v1/telegram/webhook' && config.TELEGRAM_BOT_TOKEN) {
      if (!config.TELEGRAM_WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== config.TELEGRAM_WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      const telegram = new TelegramAdapter(config.TELEGRAM_BOT_TOKEN, config, prisma, services);
      await telegram.bot.init();
      await telegram.handleWebhook(await request.json());
      return Response.json({ ok: true });
    }
    await adminRoutes(admin.instance, { config, prisma, companies: services.companies });
    await v1Routes(api.instance, { prisma, companies: services.companies, history: services.history, rateLimit: services.rateLimit, telegramConfigured: Boolean(config.TELEGRAM_BOT_TOKEN) });
    const target = url.pathname === '/health' ? new Request(new URL('/api/v1/health', url), request) : request;
    return await admin.fetch(target) ?? await api.fetch(target) ?? new Response('Not found', { status: 404 });
  } finally {
    await prisma.$disconnect();
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'worker_request_failed', errorName: error instanceof Error ? error.name : 'unknown' }));
      return Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is unavailable. Check deployment configuration and database connectivity.' } }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  },
};
