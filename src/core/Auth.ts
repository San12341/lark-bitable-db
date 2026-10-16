/**
 * 鉴权管理器（Auth）
 *
 * 负责 tenant_access_token 的获取、内存缓存与自动续期。
 *
 * 官方机制（见 RESEARCH.md 第 8 节）：
 * - 端点：`POST {domain}/open-apis/auth/v3/tenant_access_token/internal`
 * - 请求体：`{ app_id, app_secret }`
 * - 响应：`{ code, msg, tenant_access_token, expire }`，expire 单位为秒，最大 7200（2 小时）
 * - 请求头：`Authorization: Bearer {access_token}`
 *
 * 策略：
 * - 命中内存缓存且未提前过期则直接返回；否则自动获取。
 * - 提前 300 秒（5 分钟）视为过期，主动续期，避免边缘请求拿到即将失效的 token。
 * - 并发刷新使用 singleFlight 合并，仅真正发起一次网络请求。
 * - 若外部传入 userAccessToken，则直接使用它，不再自动获取 tenant token。
 */

import * as https from 'https';
import { URL } from 'url';
import { BitableAuthError } from '../error';
import { singleFlight } from '../utils';
import { BitableErrorCode } from '../types';

/** Auth 构造参数 */
export interface AuthOptions {
  /** 应用 ID（cli_ 开头） */
  appId: string;
  /** 应用密钥 */
  appSecret: string;
  /** 服务域名，如 https://open.feishu.cn */
  domain: string;
  /** 外部传入的 user_access_token；提供后不再自动获取 tenant token */
  userAccessToken?: string;
}

/** tenant_access_token 接口响应结构 */
interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  /** 有效期（秒），默认 7200 */
  expire?: number;
}

/** 提前续期的缓冲时间（毫秒）：到期前 300 秒即视为需要刷新 */
const REFRESH_AHEAD_MS = 300_000;

/**
 * 鉴权管理器
 */
export class Auth {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly domain: string;
  private readonly userAccessToken?: string;

  /** 缓存的 tenant_access_token */
  private cachedToken: string | null = null;
  /** 缓存失效时间点（毫秒时间戳，已提前扣减 300 秒） */
  private expiresAt: number = 0;

  /**
   * @param options 鉴权配置
   */
  constructor(options: AuthOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.domain = options.domain.replace(/\/+$/, '');
    this.userAccessToken = options.userAccessToken;
  }

  /**
   * 获取一个有效的 access_token。
   *
   * - 若配置了 userAccessToken，直接返回，不做任何网络请求；
   * - 若 tenant token 仍在缓存有效期内，直接返回缓存；
   * - 否则自动调用飞书接口刷新（并发安全）。
   *
   * @returns 可用于 `Authorization: Bearer` 的 token
   */
  async getToken(): Promise<string> {
    if (this.userAccessToken) {
      return this.userAccessToken;
    }
    if (this.cachedToken && Date.now() < this.expiresAt) {
      return this.cachedToken;
    }
    return this.refreshToken();
  }

  /**
   * 强制刷新 token（忽略缓存）。
   * 使用 singleFlight 合并并发刷新，保证同一时刻只发起一次网络请求。
   *
   * @returns 新获取的 token
   */
  async refreshToken(): Promise<string> {
    if (this.userAccessToken) {
      return this.userAccessToken;
    }
    return singleFlight<string>('tenant_access_token', async () => {
      const res = await this.fetchTokenFromServer();
      if (res.code !== 0 || !res.tenant_access_token) {
        throw new BitableAuthError(
          `获取 tenant_access_token 失败: ${res.msg ?? 'unknown'} (code=${res.code})`,
          res.code || BitableErrorCode.TokenInvalid,
          200,
          { rawResponse: res },
        );
      }
      this.cachedToken = res.tenant_access_token;
      const expireSeconds = res.expire ?? 7200;
      this.expiresAt = Date.now() + expireSeconds * 1000 - REFRESH_AHEAD_MS;
      return this.cachedToken;
    });
  }

  /**
   * 使当前缓存的 token 立即失效。
   * 在收到 token 过期/无效错误（99991663）时由 HttpClient 调用，
   * 下一次 getToken() 将触发刷新。
   */
  invalidate(): void {
    this.cachedToken = null;
    this.expiresAt = 0;
  }

  /**
   * 调用飞书内部接口获取 tenant_access_token（零依赖，基于 https 模块）
   */
  private fetchTokenFromServer(): Promise<TenantTokenResponse> {
    const url = new URL(`${this.domain}/open-apis/auth/v3/tenant_access_token/internal`);
    const body = JSON.stringify({ app_id: this.appId, app_secret: this.appSecret });

    return new Promise<TenantTokenResponse>((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port ? Number(url.port) : 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk as Buffer));
          res.on('end', () => {
            try {
              const text = Buffer.concat(chunks).toString('utf-8');
              resolve(JSON.parse(text) as TenantTokenResponse);
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
