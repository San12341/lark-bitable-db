import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Use vi.hoisted so the mock fn is available inside the hoisted vi.mock factory
const { mockRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
}));

vi.mock('https', () => ({
  request: mockRequest,
}));

import { Auth } from '../src/core/Auth';
import { BitableAuthError } from '../src/error';

function mockHttpsResponse(statusCode: number, body: object) {
  mockRequest.mockImplementationOnce((_opts: unknown, callback: (res: EventEmitter) => void) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn(() => {
      setImmediate(() => {
        callback(res);
        setImmediate(() => {
          res.emit('data', Buffer.from(JSON.stringify(body)));
          res.emit('end');
        });
      });
    });
    req.setTimeout = vi.fn();
    return req as any;
  });
}

describe('Auth', () => {
  beforeEach(() => {
    mockRequest.mockClear();
  });

  it('fetches tenant_access_token on first getToken', async () => {
    mockHttpsResponse(200, {
      code: 0,
      msg: 'ok',
      tenant_access_token: 't-abc',
      expire: 7200,
    });
    const auth = new Auth({
      appId: 'cli_xxx',
      appSecret: 'secret',
      domain: 'https://open.feishu.cn',
    });
    const token = await auth.getToken();
    expect(token).toBe('t-abc');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('returns cached token without re-requesting', async () => {
    mockHttpsResponse(200, {
      code: 0,
      msg: 'ok',
      tenant_access_token: 't-cached',
      expire: 7200,
    });
    const auth = new Auth({
      appId: 'cli_xxx',
      appSecret: 'secret',
      domain: 'https://open.feishu.cn',
    });
    await auth.getToken();
    const second = await auth.getToken();
    expect(second).toBe('t-cached');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('throws BitableAuthError when API returns non-zero code', async () => {
    mockHttpsResponse(200, { code: 99991663, msg: 'invalid app' });
    const auth = new Auth({
      appId: 'cli_bad',
      appSecret: 'bad',
      domain: 'https://open.feishu.cn',
    });
    await expect(auth.getToken()).rejects.toThrow(BitableAuthError);
  });

  it('invalidate clears cache and forces refetch', async () => {
    mockHttpsResponse(200, { code: 0, msg: 'ok', tenant_access_token: 't1', expire: 7200 });
    mockHttpsResponse(200, { code: 0, msg: 'ok', tenant_access_token: 't2', expire: 7200 });
    const auth = new Auth({
      appId: 'cli_xxx',
      appSecret: 'secret',
      domain: 'https://open.feishu.cn',
    });
    expect(await auth.getToken()).toBe('t1');
    auth.invalidate();
    expect(await auth.getToken()).toBe('t2');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('refreshToken forces a new request', async () => {
    mockHttpsResponse(200, { code: 0, msg: 'ok', tenant_access_token: 'old', expire: 7200 });
    mockHttpsResponse(200, { code: 0, msg: 'ok', tenant_access_token: 'new', expire: 7200 });
    const auth = new Auth({
      appId: 'cli_xxx',
      appSecret: 'secret',
      domain: 'https://open.feishu.cn',
    });
    await auth.getToken();
    const refreshed = await auth.refreshToken();
    expect(refreshed).toBe('new');
  });

  it('userAccessToken mode returns it directly without network', async () => {
    const auth = new Auth({
      appId: 'cli_xxx',
      appSecret: 'secret',
      domain: 'https://open.feishu.cn',
      userAccessToken: 'user-token-xyz',
    });
    const token = await auth.getToken();
    expect(token).toBe('user-token-xyz');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('userAccessToken refreshToken also returns it directly', async () => {
    const auth = new Auth({
      appId: 'cli_xxx',
      appSecret: 'secret',
      domain: 'https://open.feishu.cn',
      userAccessToken: 'uat',
    });
    expect(await auth.refreshToken()).toBe('uat');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('strips trailing slash from domain', async () => {
    mockHttpsResponse(200, { code: 0, msg: 'ok', tenant_access_token: 't', expire: 7200 });
    const auth = new Auth({
      appId: 'cli_xxx',
      appSecret: 'secret',
      domain: 'https://open.feishu.cn/',
    });
    await auth.getToken();
    const calledUrl = mockRequest.mock.calls[0][0] as { hostname: string; path: string };
    expect(calledUrl.hostname).toBe('open.feishu.cn');
    expect(calledUrl.path).toBe('/open-apis/auth/v3/tenant_access_token/internal');
  });
});
