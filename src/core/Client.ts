/**
 * SDK 主客户端（Client）
 *
 * 整合 Auth + HttpClient + 读/写双令牌桶限流器，并暴露同表写串行化锁。
 * 所有上层资源模块（Table/Record/Field 等）都基于本客户端发起请求。
 */

import { Auth } from './Auth';
import { HttpClient } from './HttpClient';
import { RateLimiter } from './RateLimiter';
import { TableWriteLock } from '../utils';
import { BitableConfig, HttpMethod, LarkDomain } from '../types';

/**
 * lark-bitable-db 主客户端
 *
 * @example
 * ```ts
 * const client = new Client({
 *   appId: 'cli_xxx',
 *   appSecret: 'xxx',
 *   appToken: 'bascnxxx',
 * });
 * const meta = await client.request('GET', ''); // GET /apps/:app_token
 * ```
 */
export class Client {
  /** HTTP 客户端（含鉴权、限流、重试） */
  public readonly http: HttpClient;
  /** 鉴权管理器 */
  public readonly auth: Auth;
  /** 原始配置 */
  public readonly config: BitableConfig;
  /** 同表写操作串行化锁 */
  public readonly writeLock: TableWriteLock;

  private readonly appToken: string;

  /**
   * @param config SDK 配置
   */
  constructor(config: BitableConfig) {
    this.config = config;
    this.appToken = config.appToken;

    const domain = config.domain ?? LarkDomain.Feishu;

    this.auth = new Auth({
      appId: config.appId,
      appSecret: config.appSecret,
      domain,
      userAccessToken: config.userAccessToken,
    });

    this.http = new HttpClient({
      auth: this.auth,
      rateLimiterRead: new RateLimiter({ qps: config.readQps ?? 20 }),
      rateLimiterWrite: new RateLimiter({ qps: config.writeQps ?? 50 }),
      timeout: config.timeout ?? 30_000,
      maxRetries: config.maxRetries ?? 3,
      debug: config.debug ?? false,
      domain,
    });

    this.writeLock = new TableWriteLock();
  }

  /**
   * 获取当前多维表格的 app_token
   */
  getAppToken(): string {
    return this.appToken;
  }

  /**
   * 便捷请求方法：自动在 path 前拼接 `/apps/{appToken}`，
   * 再交给 HttpClient 并解包响应 data。
   *
   * @typeParam T 响应 data 类型
   * @param method HTTP 方法
   * @param path      相对于 `/apps/:app_token` 的路径，如 `/tables/:table_id/records`
   * @param body      请求体（GET 一般不传）
   * @param isWrite   是否写操作（影响限流桶选择）；缺省时按 method 推断
   * @param retryable 是否允许自动重试；缺省时读操作 true、写操作 false
   */
  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    isWrite?: boolean,
    retryable?: boolean,
  ): Promise<T> {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const fullPath = `/apps/${this.appToken}${normalized}`;
    const write = isWrite ?? (method !== 'GET');
    const resp = await this.http.request<T>({
      method,
      url: fullPath,
      body,
      isWrite: write,
      retryable,
    });
    return resp.data.data;
  }
}
