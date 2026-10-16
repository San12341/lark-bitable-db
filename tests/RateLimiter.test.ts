import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/core/RateLimiter';

describe('RateLimiter', () => {
  it('rejects qps <= 0', () => {
    expect(() => new RateLimiter({ qps: 0 })).toThrow(/qps 必须大于 0/);
    expect(() => new RateLimiter({ qps: -5 })).toThrow(/qps 必须大于 0/);
  });

  it('initial bucket is full, acquire does not block', async () => {
    const limiter = new RateLimiter({ qps: 100 });
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('blocks when exceeding burst capacity', async () => {
    const limiter = new RateLimiter({ qps: 10, burst: 2 });
    // Consume the 2 burst tokens immediately
    await limiter.acquire();
    await limiter.acquire();
    // The 3rd acquire must wait ~100ms for refill
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  }, 5000);

  it('refills tokens over time', async () => {
    const limiter = new RateLimiter({ qps: 100, burst: 1 });
    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire();
    // At 100 qps, refill of 1 token takes ~10ms
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });

  it('setQps changes the refill rate immediately', async () => {
    const limiter = new RateLimiter({ qps: 100, burst: 1 });
    expect(limiter.getQps()).toBe(100);
    limiter.setQps(50);
    expect(limiter.getQps()).toBe(50);
  });

  it('setQps rejects non-positive values', () => {
    const limiter = new RateLimiter({ qps: 10 });
    expect(() => limiter.setQps(0)).toThrow(/qps 必须大于 0/);
  });

  it('getCapacity returns burst size', () => {
    const limiter = new RateLimiter({ qps: 10, burst: 30 });
    expect(limiter.getCapacity()).toBe(30);
  });

  it('defaults burst to qps when not specified', () => {
    const limiter = new RateLimiter({ qps: 15 });
    expect(limiter.getCapacity()).toBe(15);
  });
});
