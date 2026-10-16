/**
 * 令牌桶限流器（Token Bucket）
 *
 * 以「令牌桶」模型对请求进行匀速限速：桶按 qps 速率匀速补充令牌，
 * 桶容量等于突发上限。请求到来时消耗一个令牌；桶空则等待，直到
 * 有新令牌补充。该模型既保证长期平均速率不超过 qps，又允许短时突发。
 *
 * 飞书官方限流维度为「每个 API × 每个应用 × 每个租户」，
 * 读接口默认 20 QPS、写接口默认 50 QPS（见 RESEARCH.md 第 2 节）。
 */

import { sleep } from '../utils';
import type { RateLimiterOptions } from '../types';

/**
 * 令牌桶限流器
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({ qps: 20 });
 * await limiter.acquire(); // 拿到一个令牌后才会继续
 * ```
 */
export class RateLimiter {
  /** 当前每秒补充的令牌数（QPS） */
  private qps: number;
  /** 桶容量（允许的突发量） */
  private capacity: number;
  /** 当前桶内剩余令牌数（可为小数，表示未补充完的部分） */
  private tokens: number;
  /** 上次补充令牌的时间戳（毫秒） */
  private lastRefill: number;

  /**
   * 创建一个令牌桶限流器
   *
   * @param options 限流配置
   * @param options.qps   每秒允许的请求数（匀速补充速率）
   * @param options.burst 桶容量（突发上限），默认等于 qps
   */
  constructor(options: RateLimiterOptions) {
    if (options.qps <= 0) {
      throw new Error(`RateLimiter: qps 必须大于 0，收到 ${options.qps}`);
    }
    this.qps = options.qps;
    this.capacity = options.burst ?? options.qps;
    // 初始为满桶，允许启动时突发
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * 按经过的时间匀速补充令牌（惰性计算，不启动定时器）
   */
  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    const added = elapsedSeconds * this.qps;
    this.tokens = Math.min(this.capacity, this.tokens + added);
    this.lastRefill = now;
  }

  /**
   * 获取一个令牌。桶内有令牌则立即返回；桶空则异步等待，
   * 直到按当前 qps 补充出至少一个令牌后再继续。
   *
   * @returns 拿到令牌后 resolve
   */
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      // 还差多少毫秒才能补充出 1 个令牌
      const waitMs = Math.ceil(((1 - this.tokens) / this.qps) * 1000);
      await sleep(Math.max(waitMs, 1));
    }
  }

  /**
   * 动态调整 QPS（调整后立即生效，按新速率补充令牌）
   *
   * @param qps 新的每秒请求数（必须大于 0）
   */
  setQps(qps: number): void {
    if (qps <= 0) {
      throw new Error(`RateLimiter.setQps: qps 必须大于 0，收到 ${qps}`);
    }
    // 调整前先把旧速率下已流逝时间应补充的令牌补上
    this.refill();
    this.qps = qps;
  }

  /**
   * 获取当前 QPS
   */
  getQps(): number {
    return this.qps;
  }

  /**
   * 获取桶容量（突发上限）
   */
  getCapacity(): number {
    return this.capacity;
  }
}
