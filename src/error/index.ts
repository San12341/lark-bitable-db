/**
 * 统一异常体系
 *
 * 所有飞书 API 错误和 SDK 内部错误都通过本模块的异常类抛出。
 * 错误码映射依据官方文档（见 RESEARCH.md 第 3 节）。
 */

import { BitableErrorCode } from '../types';

/**
 * SDK 基础异常类
 */
export class BitableBaseError extends Error {
  /** 飞书 API 错误码（网络错误时为 -1） */
  public readonly code: number;
  /** HTTP 状态码（网络错误时为 0） */
  public readonly httpStatus: number;
  /** 请求 ID（用于排查） */
  public readonly requestId?: string;
  /** 原始响应体 */
  public readonly rawResponse?: unknown;

  constructor(
    message: string,
    code: number = -1,
    httpStatus: number = 0,
    options?: { requestId?: string; rawResponse?: unknown; cause?: Error },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'BitableBaseError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.requestId = options?.requestId;
    this.rawResponse = options?.rawResponse;
  }

  /** 转换为可读字符串 */
  toString(): string {
    const parts = [`[${this.name}]`, this.message];
    if (this.code !== -1) parts.push(`(code=${this.code})`);
    if (this.httpStatus > 0) parts.push(`(http=${this.httpStatus})`);
    if (this.requestId) parts.push(`(requestId=${this.requestId})`);
    return parts.join(' ');
  }
}

/**
 * 鉴权错误：token 缺失、过期、无效
 * 对应错误码：99991661, 99991663
 */
export class BitableAuthError extends BitableBaseError {
  constructor(
    message: string,
    code: number = BitableErrorCode.TokenInvalid,
    httpStatus: number = 400,
    options?: { requestId?: string; rawResponse?: unknown },
  ) {
    super(message, code, httpStatus, options);
    this.name = 'BitableAuthError';
  }
}

/**
 * 权限错误：scope 不足、无表访问权限
 * 对应错误码：99991672, 1254302, 1254303
 */
export class BitablePermissionError extends BitableBaseError {
  /** 缺少的 scope 列表（如有） */
  public readonly missingScopes?: string[];

  constructor(
    message: string,
    code: number = BitableErrorCode.PermissionDenied,
    httpStatus: number = 200,
    options?: { requestId?: string; rawResponse?: unknown; missingScopes?: string[] },
  ) {
    super(message, code, httpStatus, options);
    this.name = 'BitablePermissionError';
    this.missingScopes = options?.missingScopes;
  }
}

/**
 * 限流错误：触发 API 频率限制
 * 对应错误码：99991400, 1254290
 */
export class BitableRateLimitError extends BitableBaseError {
  /** 建议等待秒数（来自 x-ogw-ratelimit-reset 头） */
  public readonly retryAfter?: number;

  constructor(
    message: string,
    code: number = BitableErrorCode.RateLimit,
    httpStatus: number = 429,
    options?: { requestId?: string; rawResponse?: unknown; retryAfter?: number },
  ) {
    super(message, code, httpStatus, options);
    this.name = 'BitableRateLimitError';
    this.retryAfter = options?.retryAfter;
  }
}

/**
 * 资源不存在错误：app/table/record/field 不存在
 * 对应错误码：1254040, 1254041, 1254043, 1254044, 1254045
 */
export class BitableNotFoundError extends BitableBaseError {
  /** 资源类型 */
  public readonly resourceType?: 'app' | 'table' | 'view' | 'record' | 'field';

  constructor(
    message: string,
    code: number = BitableErrorCode.RecordIdNotFound,
    httpStatus: number = 200,
    options?: { requestId?: string; rawResponse?: unknown; resourceType?: 'app' | 'table' | 'view' | 'record' | 'field' },
  ) {
    super(message, code, httpStatus, options);
    this.name = 'BitableNotFoundError';
    this.resourceType = options?.resourceType;
  }
}

/**
 * 校验错误：参数错误、filter 语法错误、字段值类型错误
 * 对应错误码：1254000, 1254001, 1254018, 1254024, 1254060~072, 1254107, 1254108
 */
export class BitableValidationError extends BitableBaseError {
  /** 校验失败的字段名（如有） */
  public readonly fieldName?: string;

  constructor(
    message: string,
    code: number = BitableErrorCode.WrongRequestBody,
    httpStatus: number = 200,
    options?: { requestId?: string; rawResponse?: unknown; fieldName?: string },
  ) {
    super(message, code, httpStatus, options);
    this.name = 'BitableValidationError';
    this.fieldName = options?.fieldName;
  }
}

/**
 * 写冲突错误：同表并发写
 * 对应错误码：1254291
 */
export class BitableConflictError extends BitableBaseError {
  constructor(
    message: string,
    code: number = BitableErrorCode.WriteConflict,
    httpStatus: number = 200,
    options?: { requestId?: string; rawResponse?: unknown },
  ) {
    super(message, code, httpStatus, options);
    this.name = 'BitableConflictError';
  }
}

/**
 * 网络错误：连接失败、超时、DNS 错误等
 */
export class BitableNetworkError extends BitableBaseError {
  /** 原始 Node.js 错误 */
  public readonly cause?: Error;

  constructor(
    message: string,
    options?: { cause?: Error; requestId?: string },
  ) {
    super(message, -1, 0, { cause: options?.cause, requestId: options?.requestId });
    this.name = 'BitableNetworkError';
    this.cause = options?.cause;
  }
}

/**
 * 未分类的 API 错误
 */
export class BitableApiError extends BitableBaseError {
  constructor(
    message: string,
    code: number,
    httpStatus: number = 200,
    options?: { requestId?: string; rawResponse?: unknown },
  ) {
    super(message, code, httpStatus, options);
    this.name = 'BitableApiError';
  }
}

/**
 * 根据飞书 API 错误码创建对应的异常实例
 *
 * @param code 飞书错误码
 * @param msg 错误消息
 * @param httpStatus HTTP 状态码
 * @param headers 响应头（用于提取 retryAfter 等）
 * @param rawResponse 原始响应体
 */
export function createErrorFromCode(
  code: number,
  msg: string,
  httpStatus: number,
  headers?: Record<string, string>,
  rawResponse?: unknown,
): BitableBaseError {
  const requestId = headers?.['x-tt-logid'] || headers?.['x-request-id'];
  const retryAfterStr = headers?.['x-ogw-ratelimit-reset'];
  const retryAfter = retryAfterStr ? parseInt(retryAfterStr, 10) : undefined;

  switch (code) {
    case BitableErrorCode.MissingToken:
    case BitableErrorCode.TokenInvalid:
      return new BitableAuthError(msg || '鉴权失败：token 缺失或无效', code, httpStatus, { requestId, rawResponse });

    case BitableErrorCode.MissingScope:
      return new BitablePermissionError(msg || '权限不足：缺少所需 scope', code, httpStatus, { requestId, rawResponse });

    case BitableErrorCode.RateLimit:
    case BitableErrorCode.TooManyRequest:
      return new BitableRateLimitError(msg || '触发限流，请稍后重试', code, httpStatus, { requestId, rawResponse, retryAfter });

    case BitableErrorCode.PermissionDenied:
    case BitableErrorCode.AttachPermNotAllow:
      return new BitablePermissionError(msg || '无访问权限', code, httpStatus, { requestId, rawResponse });

    case BitableErrorCode.BaseTokenNotFound:
      return new BitableNotFoundError(msg || `多维表格不存在`, code, httpStatus, { requestId, rawResponse, resourceType: 'app' });
    case BitableErrorCode.TableIdNotFound:
    case BitableErrorCode.WrongTableId:
      return new BitableNotFoundError(msg || '数据表不存在', code, httpStatus, { requestId, rawResponse, resourceType: 'table' });
    case BitableErrorCode.ViewIdNotFound:
    case BitableErrorCode.WrongViewId:
      return new BitableNotFoundError(msg || '视图不存在', code, httpStatus, { requestId, rawResponse, resourceType: 'view' });
    case BitableErrorCode.RecordIdNotFound:
    case BitableErrorCode.WrongRecordId:
      return new BitableNotFoundError(msg || '记录不存在', code, httpStatus, { requestId, rawResponse, resourceType: 'record' });
    case BitableErrorCode.FieldIdNotFound:
    case BitableErrorCode.WrongFieldId:
    case BitableErrorCode.FieldNameNotFound:
      return new BitableNotFoundError(msg || '字段不存在', code, httpStatus, { requestId, rawResponse, resourceType: 'field' });

    case BitableErrorCode.WriteConflict:
      return new BitableConflictError(msg || '同表并发写冲突，请串行化写操作', code, httpStatus, { requestId, rawResponse });

    case BitableErrorCode.WrongRequestJson:
    case BitableErrorCode.WrongRequestBody:
    case BitableErrorCode.InvalidFilter:
    case BitableErrorCode.InvalidSort:
    case BitableErrorCode.InvalidFieldNames:
    case BitableErrorCode.InvalidPageSize:
    case BitableErrorCode.FilterTooLong:
    case BitableErrorCode.SortTooLong:
    case BitableErrorCode.CellTooLarge:
    case BitableErrorCode.BatchLimitExceeded:
    case BitableErrorCode.RecordLimitExceeded:
      return new BitableValidationError(msg || '参数校验失败', code, httpStatus, { requestId, rawResponse });

    case BitableErrorCode.RequestTimeout:
      return new BitableNetworkError(msg || '请求超时', { requestId });

    default:
      return new BitableApiError(msg || `API 错误 (code=${code})`, code, httpStatus, { requestId, rawResponse });
  }
}

/**
 * 判断错误码是否可重试
 */
export function isRetryableCode(code: number): boolean {
  const retryableCodes = [
    BitableErrorCode.RateLimit,
    BitableErrorCode.TooManyRequest,
    BitableErrorCode.InternalError,
    BitableErrorCode.DataNotReady,
    BitableErrorCode.RequestTimeout,
    BitableErrorCode.TokenInvalid, // token 过期，刷新后可重试
  ];
  return retryableCodes.includes(code);
}
