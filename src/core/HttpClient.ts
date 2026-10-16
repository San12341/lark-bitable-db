/**
 * HTTP 客户端（HttpClient）
 *
 * 基于 Node.js 内置 https/http 模块实现（零运行时依赖），负责：
 * - 自动注入 `Authorization: Bearer <token>` 与 `Content-Type: application/json`
 * - 按是否写操作选择读/写令牌桶限流器
 * - 统一错误处理：HTTP 非 2xx 或业务 code !== 0 时通过 createErrorFromCode 抛出对应异常
 * - 自动重试：对可重试错误做指数退避；429 优先读取 `x-ogw-ratelimit-reset`；
 *   token 过期（99991663）先 invalidate + refreshToken 再重试
 * - 超时控制（默认 30s）与可选调试日志
 *
 * 基础路径：`{domain}/open-apis/bitable/v1`（见 RESEARCH.md）。
 */

import * as http from 'http';
import * as https from 'https';
import { URL, URLSearchParams } from 'url';
import { Auth } from './Auth';
import { RateLimiter } from './RateLimiter';
import {
  BitableApiError,
  BitableBaseError,
  BitableNetworkError,
  BitableRateLimitError,
  createErrorFromCode,
  isRetryableCode,
} from '../error';
import { exponentialBackoff, generateRequestId, sleep } from '../utils';
import {
  BitableApiResponse,
  BitableErrorCode,
  HttpMethod,
  HttpRequestOptions,
  HttpResponse,
} from '../types';

/** HttpClient 构造参数 */
export interface HttpClientOptions {
  /** 鉴权管理器（用于获取/刷新 token） */
  auth: Auth;
  /** 读接口限流器 */
  rateLimiterRead: RateLimiter;
  /** 写接口限流器 */
  rateLimiterWrite: RateLimiter;
  /** 请求超时（毫秒），默认 30000 */
  timeout?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 是否打印调试日志，默认 false */
  debug?: boolean;
  /** 服务域名，如 https://open.feishu.cn */
  domain: string;
}

/** 原始请求结果（未做业务错误处理） */
interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** 重试计划结果 */
interface RetryPlan {
  /** 是否需要重试 */
  retry: boolean;
  /** 重试前等待毫秒数 */
  delay: number;
  /** 重试前是否需要先刷新 token */
  shouldRefreshToken: boolean;
  /** 错误本可自动重试，但因非幂等写操作（retryable=false）被阻止 */
  suppressedRetry?: boolean;
}

/**
 * HTTP 客户端
 */
export class HttpClient {
  private readonly auth: Auth;
  private readonly rateLimiterRead: RateLimiter;
  private readonly rateLimiterWrite: RateLimiter;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly debug: boolean;
  /** 业务接口基础路径：{domain}/open-apis/bitable/v1 */
  private readonly baseUrl: string;

  /**
   * @param options 客户端配置
   */
  constructor(options: HttpClientOptions) {
    this.auth = options.auth;
    this.rateLimiterRead = options.rateLimiterRead;
    this.rateLimiterWrite = options.rateLimiterWrite;
    this.timeout = options.timeout ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.debug = options.debug ?? false;
    this.baseUrl = `${options.domain.replace(/\/+$/, '')}/open-apis/bitable/v1`;
  }

  /**
   * 发起一次完整请求（含限流、鉴权、错误归一与自动重试）。
   *
   * @typeParam T 飞书响应 data 字段的类型
   * @param options 请求配置
   * @returns 成功时返回完整响应信封；失败时（重试耗尽后）抛出 BitableBaseError 子类
   */
  async request<T>(
    options: HttpRequestOptions,
  ): Promise<HttpResponse<BitableApiResponse<T>>> {
    const timeout = options.timeout ?? this.timeout;
    const isWrite = options.isWrite ?? false;
    // 默认：读操作可自动重试；写操作不可（避免 create 等非幂等操作重复执行）
    const retryable = options.retryable ?? !isWrite;
    const limiter = isWrite ? this.rateLimiterWrite : this.rateLimiterRead;
    const method = options.method;
    const fullUrl = this.resolveUrl(options.url);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // 每次尝试都经过限流桶（重试同样消耗配额）
      await limiter.acquire();

      const requestId = generateRequestId();
      const token = await this.auth.getToken();
      const headers: Record<string, string> = {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      };
      const bodyStr =
        options.body !== undefined && options.body !== null
          ? JSON.stringify(options.body)
          : undefined;

      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log(`[bitable] -> ${method} ${fullUrl} (attempt ${attempt + 1}/${this.maxRetries + 1})`);
      }

      try {
        const raw = await this.executeRaw(method, fullUrl, headers, bodyStr, timeout);

        let parsed: unknown;
        try {
          parsed = raw.body ? (JSON.parse(raw.body) as unknown) : undefined;
        } catch {
          parsed = undefined;
        }

        if (this.debug) {
          // eslint-disable-next-line no-console
          console.log(`[bitable] <- ${raw.status}`, parsed ?? raw.body.slice(0, 200));
        }

        // HTTP 层非 2xx：归一化为对应异常
        if (raw.status < 200 || raw.status >= 300) {
          throw this.classifyHttpError(raw.status, raw.headers, parsed);
        }

        const envelope = parsed as BitableApiResponse<T> | undefined;
        if (!envelope || typeof envelope.code !== 'number') {
          throw new BitableNetworkError(
            `响应不是合法的飞书 JSON 信封: ${raw.body.slice(0, 200)}`,
            { requestId },
          );
        }

        // 业务层错误码
        if (envelope.code !== 0) {
          throw createErrorFromCode(envelope.code, envelope.msg, raw.status, raw.headers, envelope);
        }

        return { status: raw.status, headers: raw.headers, data: envelope };
      } catch (err) {
        // 把 Node 原生错误统一包装为 BitableNetworkError
        const normalized =
          err instanceof BitableBaseError
            ? err
            : new BitableNetworkError(
                err instanceof Error ? err.message : String(err),
                { cause: err instanceof Error ? err : undefined, requestId },
              );

        const plan = this.planRetry(normalized, attempt, retryable);
        if (!plan.retry || attempt === this.maxRetries) {
          if (plan.suppressedRetry) {
            normalized.message =
              `${normalized.message}（该写操作默认不自动重试，以避免非幂等写入重复执行；` +
              `如确认幂等可在请求选项中设置 retryable: true 后重试）`;
          }
          throw normalized;
        }

        if (plan.shouldRefreshToken) {
          this.auth.invalidate();
          await this.auth.refreshToken();
        }
        if (plan.delay > 0) {
          await sleep(plan.delay);
        }
      }
    }

    // 理论上不会走到这里（循环内必 return 或 throw）
    throw new BitableNetworkError('请求失败：未知错误');
  }

  /**
   * GET 便捷方法（读操作）。自动拼接 query 参数并解包响应 data。
   *
   * @param path 相对路径（相对于 baseUrl），如 `/apps/:app_token/tables`
   * @param params 查询参数
   */
  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    let url = path;
    if (params) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) usp.append(k, String(v));
      }
      const qs = usp.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    const resp = await this.request<T>({ method: 'GET', url, isWrite: false });
    return resp.data.data;
  }

  /**
   * POST 便捷方法（写操作，isWrite=true）
   *
   * @param path      相对路径
   * @param body      请求体
   * @param retryable 是否允许自动重试（默认 false，避免非幂等写重复执行）
   */
  async post<T>(path: string, body?: unknown, retryable?: boolean): Promise<T> {
    const resp = await this.request<T>({
      method: 'POST',
      url: path,
      body,
      isWrite: true,
      retryable,
    });
    return resp.data.data;
  }

  /**
   * PUT 便捷方法（写操作，isWrite=true）
   *
   * @param path      相对路径
   * @param body      请求体
   * @param retryable 是否允许自动重试（默认 false）
   */
  async put<T>(path: string, body?: unknown, retryable?: boolean): Promise<T> {
    const resp = await this.request<T>({
      method: 'PUT',
      url: path,
      body,
      isWrite: true,
      retryable,
    });
    return resp.data.data;
  }

  /**
   * DELETE 便捷方法（写操作，isWrite=true）
   *
   * @param path      相对路径
   * @param body      请求体
   * @param retryable 是否允许自动重试（默认 false）
   */
  async delete<T>(path: string, body?: unknown, retryable?: boolean): Promise<T> {
    const resp = await this.request<T>({
      method: 'DELETE',
      url: path,
      body,
      isWrite: true,
      retryable,
    });
    return resp.data.data;
  }

  /**
   * 解析请求 URL：绝对 URL 原样返回，相对路径拼到 baseUrl 之后
   */
  private resolveUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    return this.baseUrl + (url.startsWith('/') ? url : `/${url}`);
  }

  /**
   * 将 HTTP 非 2xx 响应归一化为对应业务异常
   */
  private classifyHttpError(
    status: number,
    headers: Record<string, string>,
    parsed: unknown,
  ): BitableBaseError {
    const envelope = parsed as { code?: number; msg?: string } | undefined;
    if (envelope && typeof envelope.code === 'number') {
      return createErrorFromCode(envelope.code, envelope.msg ?? '', status, headers, parsed);
    }
    if (status === 429) {
      return createErrorFromCode(BitableErrorCode.RateLimit, 'Too Many Requests', status, headers, parsed);
    }
    if (status === 401 || status === 403) {
      return createErrorFromCode(BitableErrorCode.TokenInvalid, `HTTP ${status}`, status, headers, parsed);
    }
    return new BitableApiError(`HTTP ${status}`, -1, status, { rawResponse: parsed });
  }

  /**
   * 根据异常类型与当前重试次数，决定是否重试、等待多久、是否需刷新 token。
   *
   * @param err        归一化后的异常
   * @param attempt    当前重试次数
   * @param retryable  是否允许自动重试（读默认 true，写默认 false）
   */
  private planRetry(err: BitableBaseError, attempt: number, retryable: boolean): RetryPlan {
    // token 过期/无效：先刷新再重试。
    // 此类请求被服务端拒绝、未实际处理，重试不会造成重复写入，不受 retryable 限制
    if (err.code === BitableErrorCode.TokenInvalid) {
      return { retry: true, delay: 0, shouldRefreshToken: true };
    }

    // 非幂等写操作：不自动重试，避免「请求已达但响应超时」时重复写入
    if (!retryable) {
      const wouldRetry =
        err instanceof BitableNetworkError || isRetryableCode(err.code);
      return { retry: false, delay: 0, shouldRefreshToken: false, suppressedRetry: wouldRetry };
    }

    // 网络错误（连接失败/超时/重置等）：指数退避
    if (err instanceof BitableNetworkError) {
      return { retry: true, delay: exponentialBackoff(attempt + 1), shouldRefreshToken: false };
    }

    // 其他可重试业务错误码
    if (isRetryableCode(err.code)) {
      let delay = exponentialBackoff(attempt + 1);
      // 限流错误优先采用服务端建议的恢复时间（秒）
      if (err instanceof BitableRateLimitError && typeof err.retryAfter === 'number') {
        delay = Math.max(err.retryAfter * 1000, 0);
      }
      return { retry: true, delay, shouldRefreshToken: false };
    }

    return { retry: false, delay: 0, shouldRefreshToken: false };
  }

  /**
   * 基于 Node 内置 https/http 模块执行一次原始 HTTP 请求
   */
  private executeRaw(
    method: HttpMethod,
    fullUrl: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeout: number,
  ): Promise<RawResponse> {
    return new Promise<RawResponse>((resolve, reject) => {
      const url = new URL(fullUrl);
      const client = url.protocol === 'http:' ? http : https;

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === 'http:' ? 80 : 443,
        path: url.pathname + url.search,
        method,
        headers,
      };

      const req = client.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: this.normalizeHeaders(res.headers),
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(timeout, () => {
        req.destroy(new Error(`Request timed out after ${timeout}ms`));
      });

      if (body) req.write(body);
      req.end();
    });
  }

  /**
   * 将 Node 的 IncomingHttpHeaders（值可能为 string[]）归一化为 Record<string,string>
   */
  private normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (Array.isArray(v)) out[k] = v.join(',');
      else if (v !== undefined) out[k] = v;
    }
    return out;
  }
}
