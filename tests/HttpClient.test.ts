import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const { mockHttpsRequest, mockHttpRequest } = vi.hoisted(() => ({
  mockHttpsRequest: vi.fn(),
  mockHttpRequest: vi.fn(),
}));

vi.mock('https', () => ({ request: mockHttpsRequest }));
vi.mock('http', () => ({ request: mockHttpRequest }));

import { HttpClient } from '../src/core/HttpClient';
import { RateLimiter } from '../src/core/RateLimiter';
import {
  BitableAuthError,
  BitableNotFoundError,
  BitableRateLimitError,
  BitableNetworkError,
} from '../src/error';
import { BitableErrorCode } from '../src/types';

type RawResponse = { status: number; headers: Record<string, string>; body: string };
let responseQueue: RawResponse[] = [];

function mockNextResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  responseQueue.push({
    status,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function setupMockRequest() {
  const impl = (_opts: unknown, callback: (res: EventEmitter) => void) => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    const req = new EventEmitter();
    (req as any).write = vi.fn();
    (req as any).setTimeout = vi.fn();
    (req as any).end = vi.fn(() => {
      setImmediate(() => {
        const next = responseQueue.shift() ?? { status: 200, headers: {}, body: '{}' };
        (res as any).statusCode = next.status;
        res.headers = next.headers;
        callback(res);
        setImmediate(() => {
          res.emit('data', Buffer.from(next.body));
          res.emit('end');
        });
      });
    });
    return req as any;
  };
  mockHttpsRequest.mockImplementation(impl);
  mockHttpRequest.mockImplementation(impl);
}

function createTestClient(options: { maxRetries?: number } = {}) {
  const auth = {
    getToken: vi.fn().mockResolvedValue('test-token'),
    invalidate: vi.fn(),
    refreshToken: vi.fn().mockResolvedValue('refreshed-token'),
  };
  const limiterRead = new RateLimiter({ qps: 1000 });
  const limiterWrite = new RateLimiter({ qps: 1000 });
  return new HttpClient({
    auth: auth as any,
    rateLimiterRead: limiterRead,
    rateLimiterWrite: limiterWrite,
    timeout: 5000,
    maxRetries: options.maxRetries ?? 0,
    domain: 'https://open.feishu.cn',
  });
}

describe('HttpClient', () => {
  beforeEach(() => {
    responseQueue = [];
    mockHttpsRequest.mockClear();
    mockHttpRequest.mockClear();
    setupMockRequest();
  });

  it('unwraps data field on success', async () => {
    mockNextResponse(200, { code: 0, msg: 'ok', data: { hello: 'world' } });
    const client = createTestClient();
    const data = await client.get<{ hello: string }>('/apps/app1/tables/tbl1/records');
    expect(data).toEqual({ hello: 'world' });
  });

  it('maps 99991663 to BitableAuthError', async () => {
    mockNextResponse(200, { code: BitableErrorCode.TokenInvalid, msg: 'token expired', data: {} });
    const client = createTestClient();
    await expect(client.get('/x')).rejects.toThrow(BitableAuthError);
  });

  it('maps 1254043 to BitableNotFoundError', async () => {
    mockNextResponse(200, { code: BitableErrorCode.RecordIdNotFound, msg: 'not found', data: {} });
    const client = createTestClient();
    await expect(client.get('/x')).rejects.toThrow(BitableNotFoundError);
  });

  it('maps 99991400 to BitableRateLimitError', async () => {
    mockNextResponse(200, { code: BitableErrorCode.RateLimit, msg: 'slow down', data: {} });
    const client = createTestClient();
    await expect(client.get('/x')).rejects.toThrow(BitableRateLimitError);
  });

  it('429 HTTP status maps to rate limit error with retryAfter from header', async () => {
    mockNextResponse(429, { code: BitableErrorCode.RateLimit, msg: 'too many' }, {
      'x-ogw-ratelimit-reset': '5',
    });
    const client = createTestClient();
    try {
      await client.get('/x');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BitableRateLimitError);
      expect((e as BitableRateLimitError).retryAfter).toBe(5);
    }
  });

  it('retries on token expired then succeeds after refresh', async () => {
    mockNextResponse(200, { code: BitableErrorCode.TokenInvalid, msg: 'expired', data: {} });
    mockNextResponse(200, { code: 0, msg: 'ok', data: { retried: true } });

    const client = createTestClient({ maxRetries: 1 });
    const data = await client.get<{ retried: boolean }>('/x');
    expect(data).toEqual({ retried: true });
  });

  it('POST sends body and unwraps data', async () => {
    mockNextResponse(200, { code: 0, msg: 'ok', data: { created: true, id: 'rec1' } });
    const client = createTestClient();
    const result = await client.post('/x/records', { fields: { name: 'test' } });
    expect(result).toEqual({ created: true, id: 'rec1' });
  });

  it('PUT sends body', async () => {
    mockNextResponse(200, { code: 0, msg: 'ok', data: { updated: true } });
    const client = createTestClient();
    await expect(client.put('/x/records/rec1', { fields: {} })).resolves.toEqual({ updated: true });
  });

  it('DELETE works', async () => {
    mockNextResponse(200, { code: 0, msg: 'ok', data: { deleted: true } });
    const client = createTestClient();
    await expect(client.delete('/x/records/rec1')).resolves.toEqual({ deleted: true });
  });

  it('throws BitableNetworkError on non-JSON response', async () => {
    mockNextResponse(200, '<html>not json</html>');
    const client = createTestClient();
    await expect(client.get('/x')).rejects.toThrow(BitableNetworkError);
  });

  it('throws when envelope has non-zero code', async () => {
    mockNextResponse(200, { code: 1254001, msg: 'bad request', data: {} });
    const client = createTestClient();
    await expect(client.get('/x')).rejects.toThrow(/bad request/);
  });
});
