import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/app-error.js';

export interface RateLimitDecision {
  allowed: boolean;
  count: number;
  resetAt: Date;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now?: Date): Promise<RateLimitDecision>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: Date }>();

  async consume(key: string, limit: number, windowMs: number, now = new Date()): Promise<RateLimitDecision> {
    const current = this.buckets.get(key);
    if (!current || current.resetAt.getTime() <= now.getTime()) {
      const fresh = { count: 1, resetAt: new Date(now.getTime() + windowMs) };
      this.buckets.set(key, fresh);
      return { allowed: true, ...fresh };
    }
    if (current.count >= limit) return { allowed: false, ...current };
    current.count += 1;
    return { allowed: true, ...current };
  }
}

export class PrismaRateLimitStore implements RateLimitStore {
  constructor(private readonly prisma: PrismaClient) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    const rows = await this.prisma.$queryRaw<Array<{ count: number; reset_at: Date }>>`
      INSERT INTO "rate_limit_buckets" ("key", "count", "reset_at")
      VALUES (${key}, 1, CURRENT_TIMESTAMP + (${windowSeconds} * INTERVAL '1 second'))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "rate_limit_buckets"."reset_at" <= CURRENT_TIMESTAMP THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
        "reset_at" = CASE WHEN "rate_limit_buckets"."reset_at" <= CURRENT_TIMESTAMP
          THEN CURRENT_TIMESTAMP + (${windowSeconds} * INTERVAL '1 second')
          ELSE "rate_limit_buckets"."reset_at" END
      WHERE "rate_limit_buckets"."reset_at" <= CURRENT_TIMESTAMP OR "rate_limit_buckets"."count" < ${limit}
      RETURNING "count", "reset_at"
    `;

    if (rows.length > 0) {
      const row = rows[0];
      if (row) return { allowed: true, count: Number(row.count), resetAt: row.reset_at };
    }
    const bucket = await this.prisma.rateLimitBucket.findUnique({ where: { key }, select: { count: true, resetAt: true } });
    return {
      allowed: false,
      count: bucket?.count ?? limit,
      resetAt: bucket?.resetAt ?? new Date(Date.now() + windowMs),
    };
  }
}

export class RateLimitService {
  constructor(
    private readonly store: RateLimitStore,
    private readonly limit: number,
    private readonly windowSeconds: number,
  ) {}

  async consume(key: string): Promise<void> {
    const decision = await this.store.consume(key, this.limit, this.windowSeconds * 1000);
    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000));
      throw new AppError('RATE_LIMITED', 'Search limit reached. Please try again after the limit resets.', { retryAfterSeconds });
    }
  }
}
