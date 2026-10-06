import { describe, expect, it } from 'vitest';
import { InMemoryRateLimitStore } from '../src/modules/rate-limit/rate-limit.service.js';

describe('fixed-window rate limit store', () => {
  it('allows requests to the limit, rejects extras, then resets the bucket', async () => {
    const store = new InMemoryRateLimitStore();
    const start = new Date('2026-09-24T12:00:00.000Z');
    expect((await store.consume('telegram:1', 2, 60_000, start)).allowed).toBe(true);
    expect((await store.consume('telegram:1', 2, 60_000, start)).allowed).toBe(true);
    expect((await store.consume('telegram:1', 2, 60_000, start)).allowed).toBe(false);
    expect((await store.consume('telegram:1', 2, 60_000, new Date(start.getTime() + 60_001))).allowed).toBe(true);
  });

  it('isolates buckets by identity', async () => {
    const store = new InMemoryRateLimitStore();
    const now = new Date();
    await store.consume('telegram:one', 1, 60_000, now);
    expect((await store.consume('telegram:two', 1, 60_000, now)).allowed).toBe(true);
  });
});
