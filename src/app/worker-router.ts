import { Validator, type Schema } from '@cfworker/json-schema';
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyBaseLogger } from 'fastify';
import { AppError } from '../shared/app-error.js';

type Handler = (request: FastifyRequest, reply: FastifyReply, payload?: unknown) => unknown;
interface Route { method: string; path: string; schema?: Record<string, Schema>; handler: Handler; }

// The shared route modules only need registration, hooks, and request/reply objects.
// This adapter runs them against Web Requests without starting a Node HTTP server.
export class WorkerRouter {
  private routes: Route[] = [];
  private hooks: Record<string, Handler[]> = {};
  readonly logger = Object.fromEntries(['info', 'warn', 'error', 'debug', 'trace', 'fatal'].map((level) => [level, (fields: unknown, message: string) => {
    if (['warn', 'error', 'fatal'].includes(level)) console.log(JSON.stringify({ level, message, fields }));
  }])) as unknown as FastifyBaseLogger;

  constructor(private prefix: string) {}

  get instance(): FastifyInstance {
    const register = (method: string) => (path: string, options: { schema?: Record<string, Schema> } | Handler, handler?: Handler) => {
      this.routes.push({ method, path: this.prefix + path, ...(typeof options === 'object' && options.schema ? { schema: options.schema } : {}), handler: handler ?? options as Handler });
    };
    return {
      get: register('GET'), post: register('POST'),
      addHook: (name: string, handler: Handler) => { (this.hooks[name] ??= []).push(handler); },
    } as unknown as FastifyInstance;
  }

  async fetch(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    for (const route of this.routes) {
      if (route.method !== request.method && !(request.method === 'HEAD' && route.method === 'GET')) continue;
      const names: string[] = [];
      const pattern = route.path.split('/').map((part) => {
        if (part.startsWith(':')) { names.push(part.slice(1)); return '([^/]+)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('/');
      const match = new RegExp(`^${pattern}$`).exec(url.pathname);
      if (!match) continue;
      const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': crypto.randomUUID() });
      let status = 200;
      let sent = false;
      let payload: unknown;
      const reply = {
        code(value: number) { status = value; return this; },
        header(name: string, value: string) { headers.set(name, value); return this; },
        send(value: unknown) { payload = value; sent = true; return this; },
      } as unknown as FastifyReply;
      const req = {
        headers: Object.fromEntries(request.headers),
        params: Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? '')])),
        query: Object.fromEntries(url.searchParams),
        body: undefined,
        ip: request.headers.get('cf-connecting-ip') ?? '127.0.0.1',
        id: headers.get('x-request-id'), log: this.logger,
      } as unknown as FastifyRequest;
      try {
        // Authenticate before parsing request bodies or touching the database.
        for (const hook of this.hooks.preHandler ?? []) { await hook(req, reply); if (sent) break; }
        if (!sent) {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: { code: 'INVALID_QUERY', message: 'Content-Type must be application/json.' } }, { status: 415 });
            const text = await request.text();
            if (new TextEncoder().encode(text).length > 1024 * 1024) return new Response('Payload too large', { status: 413 });
            try { req.body = JSON.parse(text); } catch { throw new AppError('INVALID_QUERY', 'Invalid JSON body.'); }
          }
          for (const part of ['params', 'querystring', 'body'] as const) {
            const schema = route.schema?.[part];
            if (!schema) continue;
            const data = part === 'querystring' ? req.query as Record<string, unknown> : req[part];
            if (part === 'querystring') {
              for (const [key, property] of Object.entries(schema.properties ?? {})) {
                if (typeof property !== 'object') continue;
                const values = data as Record<string, unknown>;
                if (values[key] === undefined && 'default' in property) values[key] = property.default;
                if (['integer', 'number'].includes(String(property.type)) && typeof values[key] === 'string' && values[key] !== '') values[key] = Number(values[key]);
              }
            }
            if (!new Validator(schema).validate(data).valid) throw new AppError('INVALID_QUERY', 'Request validation failed.');
          }
          const result = await route.handler(req, reply);
          if (!sent) payload = result;
        }
      } catch (error) {
        status = error instanceof AppError ? error.statusCode : 500;
        payload = { error: { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : 'An unexpected error occurred.', requestId: req.id } };
        if (!(error instanceof AppError)) this.logger.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Worker request failed');
      }
      for (const hook of this.hooks.onSend ?? []) payload = await hook(req, reply, payload);
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(payload ?? null), { status, headers });
    }
    return null;
  }
}
