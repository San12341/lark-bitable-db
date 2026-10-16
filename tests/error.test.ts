import { describe, it, expect } from 'vitest';
import {
  BitableBaseError,
  BitableAuthError,
  BitablePermissionError,
  BitableRateLimitError,
  BitableNotFoundError,
  BitableValidationError,
  BitableConflictError,
  BitableNetworkError,
  BitableApiError,
  createErrorFromCode,
  isRetryableCode,
} from '../src/error';
import { BitableErrorCode } from '../src/types';

describe('error hierarchy', () => {
  it('BitableBaseError carries code, httpStatus, requestId, rawResponse', () => {
    const err = new BitableBaseError('boom', 123, 500, {
      requestId: 'req-1',
      rawResponse: { foo: 1 },
    });
    expect(err.name).toBe('BitableBaseError');
    expect(err.code).toBe(123);
    expect(err.httpStatus).toBe(500);
    expect(err.requestId).toBe('req-1');
    expect(err.rawResponse).toEqual({ foo: 1 });
    expect(err).toBeInstanceOf(Error);
  });

  it('toString includes name, message, code, httpStatus, requestId', () => {
    const err = new BitableBaseError('msg', 1254043, 200, { requestId: 'abc' });
    const s = err.toString();
    expect(s).toContain('[BitableBaseError]');
    expect(s).toContain('msg');
    expect(s).toContain('code=1254043');
    expect(s).toContain('http=200');
    expect(s).toContain('requestId=abc');
  });

  it('toString omits code=-1 and http=0', () => {
    const err = new BitableBaseError('net fail');
    const s = err.toString();
    expect(s).toBe('[BitableBaseError] net fail');
  });

  it('BitableAuthError defaults to TokenInvalid code', () => {
    const err = new BitableAuthError('bad token');
    expect(err.name).toBe('BitableAuthError');
    expect(err.code).toBe(BitableErrorCode.TokenInvalid);
    expect(err.httpStatus).toBe(400);
  });

  it('BitableRateLimitError carries retryAfter', () => {
    const err = new BitableRateLimitError('rate', BitableErrorCode.RateLimit, 429, {
      retryAfter: 5,
    });
    expect(err.retryAfter).toBe(5);
  });

  it('BitableNotFoundError carries resourceType', () => {
    const err = new BitableNotFoundError('no record', undefined, undefined, {
      resourceType: 'record',
    });
    expect(err.resourceType).toBe('record');
  });

  it('BitablePermissionError carries missingScopes', () => {
    const err = new BitablePermissionError('denied', undefined, undefined, {
      missingScopes: ['bitable:app'],
    });
    expect(err.missingScopes).toEqual(['bitable:app']);
  });

  it('BitableValidationError carries fieldName', () => {
    const err = new BitableValidationError('bad field', undefined, undefined, {
      fieldName: 'age',
    });
    expect(err.fieldName).toBe('age');
  });

  it('BitableNetworkError has code=-1 httpStatus=0', () => {
    const err = new BitableNetworkError('econn');
    expect(err.code).toBe(-1);
    expect(err.httpStatus).toBe(0);
  });
});

describe('createErrorFromCode', () => {
  it('maps token errors to BitableAuthError', () => {
    const e1 = createErrorFromCode(BitableErrorCode.TokenInvalid, 'x', 200);
    expect(e1).toBeInstanceOf(BitableAuthError);
    const e2 = createErrorFromCode(BitableErrorCode.MissingToken, 'x', 200);
    expect(e2).toBeInstanceOf(BitableAuthError);
  });

  it('maps rate limit codes to BitableRateLimitError with retryAfter from header', () => {
    const e = createErrorFromCode(
      BitableErrorCode.RateLimit,
      'slow',
      429,
      { 'x-ogw-ratelimit-reset': '3' },
    );
    expect(e).toBeInstanceOf(BitableRateLimitError);
    expect((e as BitableRateLimitError).retryAfter).toBe(3);
  });

  it('maps too-many-request to rate limit', () => {
    const e = createErrorFromCode(BitableErrorCode.TooManyRequest, '', 200);
    expect(e).toBeInstanceOf(BitableRateLimitError);
  });

  it('maps missing scope to BitablePermissionError', () => {
    const e = createErrorFromCode(BitableErrorCode.MissingScope, '', 200);
    expect(e).toBeInstanceOf(BitablePermissionError);
  });

  it('maps permission denied and attach perm to BitablePermissionError', () => {
    expect(createErrorFromCode(BitableErrorCode.PermissionDenied, '', 200)).toBeInstanceOf(
      BitablePermissionError,
    );
    expect(createErrorFromCode(BitableErrorCode.AttachPermNotAllow, '', 200)).toBeInstanceOf(
      BitablePermissionError,
    );
  });

  it('maps not-found codes to BitableNotFoundError with resourceType', () => {
    expect(createErrorFromCode(BitableErrorCode.BaseTokenNotFound, '', 200)).toMatchObject({
      resourceType: 'app',
    });
    expect(createErrorFromCode(BitableErrorCode.TableIdNotFound, '', 200)).toMatchObject({
      resourceType: 'table',
    });
    expect(createErrorFromCode(BitableErrorCode.ViewIdNotFound, '', 200)).toMatchObject({
      resourceType: 'view',
    });
    expect(createErrorFromCode(BitableErrorCode.RecordIdNotFound, '', 200)).toMatchObject({
      resourceType: 'record',
    });
    expect(createErrorFromCode(BitableErrorCode.FieldIdNotFound, '', 200)).toMatchObject({
      resourceType: 'field',
    });
  });

  it('maps write conflict to BitableConflictError', () => {
    const e = createErrorFromCode(BitableErrorCode.WriteConflict, '', 200);
    expect(e).toBeInstanceOf(BitableConflictError);
  });

  it('maps validation codes to BitableValidationError', () => {
    const codes = [
      BitableErrorCode.WrongRequestJson,
      BitableErrorCode.WrongRequestBody,
      BitableErrorCode.InvalidFilter,
      BitableErrorCode.InvalidSort,
      BitableErrorCode.InvalidFieldNames,
      BitableErrorCode.InvalidPageSize,
      BitableErrorCode.FilterTooLong,
      BitableErrorCode.SortTooLong,
      BitableErrorCode.CellTooLarge,
      BitableErrorCode.BatchLimitExceeded,
      BitableErrorCode.RecordLimitExceeded,
    ];
    for (const c of codes) {
      expect(createErrorFromCode(c, '', 200)).toBeInstanceOf(BitableValidationError);
    }
  });

  it('maps request timeout to BitableNetworkError', () => {
    const e = createErrorFromCode(BitableErrorCode.RequestTimeout, '', 200);
    expect(e).toBeInstanceOf(BitableNetworkError);
  });

  it('unknown codes fall back to BitableApiError', () => {
    const e = createErrorFromCode(99999999, 'unknown', 200);
    expect(e).toBeInstanceOf(BitableApiError);
    expect(e.code).toBe(99999999);
  });

  it('extracts requestId from x-tt-logid header', () => {
    const e = createErrorFromCode(1254000, '', 200, { 'x-tt-logid': 'log-123' });
    expect(e.requestId).toBe('log-123');
  });
});

describe('isRetryableCode', () => {
  it('returns true for retryable codes', () => {
    expect(isRetryableCode(BitableErrorCode.RateLimit)).toBe(true);
    expect(isRetryableCode(BitableErrorCode.TooManyRequest)).toBe(true);
    expect(isRetryableCode(BitableErrorCode.InternalError)).toBe(true);
    expect(isRetryableCode(BitableErrorCode.DataNotReady)).toBe(true);
    expect(isRetryableCode(BitableErrorCode.RequestTimeout)).toBe(true);
    expect(isRetryableCode(BitableErrorCode.TokenInvalid)).toBe(true);
  });

  it('returns false for non-retryable codes', () => {
    expect(isRetryableCode(BitableErrorCode.PermissionDenied)).toBe(false);
    expect(isRetryableCode(BitableErrorCode.RecordIdNotFound)).toBe(false);
    expect(isRetryableCode(BitableErrorCode.WrongRequestBody)).toBe(false);
  });
});
