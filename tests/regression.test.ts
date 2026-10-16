/**
 * 缺陷修复回归测试（针对真实 src/ 模块，不使用复刻副本）
 *
 * 覆盖 CODE_REVIEW_REPORT.md 中全部 9 项缺陷的修复行为：
 *  1+4. TableWriteLock 互斥与清理
 *  2.   Auth 多实例 token 隔离
 *  3.   where(field, 'isEmpty') 无值操作符解析
 *  5.   findAll() limit 提前终止
 *  6.   非幂等写默认不自动重试
 *  7.   Webhook 验签长度不等返回 false
 *  8.   findPage 客户端过滤空页语义
 *  9.   countExact() 精确计数
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';
import { EventEmitter } from 'events';

import { TableWriteLock } from '../src/utils';
import { QueryBuilder } from '../src/query/QueryBuilder';
import { Schema } from '../src/model/Schema';
import { FieldType, FilterOperator } from '../src/types';
import { verifyWebhookSignature } from '../src/core/Webhook';
import { HttpClient } from '../src/core/HttpClient';
import { RateLimiter } from '../src/core/RateLimiter';
import { BitableValidationError } from '../src/error';
import type { Auth } from '../src/core/Auth';
import type { Client } from '../src/core/Client';

// ============================================================
// 缺陷 1+4：TableWriteLock 真实互斥与内存清理
// ============================================================
describe('[FIX 1+4] TableWriteLock 互斥与清理', () => {
  const measure = async (lock: TableWriteLock, names: string[], tableIdOf: (n: string) => string) => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const order: string[] = [];
    const task = async (name: string) => {
      const release = await lock.acquire(tableIdOf(name));
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      order.push(name);
      await new Promise((r) => setTimeout(r, 10));
      concurrent -= 1;
      release();
    };
    await Promise.all(names.map((n) => task(n)));
    return { maxConcurrent, order };
  };

  it('同表并发 acquire 严格串行（maxConcurrent=1，FIFO 顺序）', async () => {
    const lock = new TableWriteLock();
    const { maxConcurrent, order } = await measure(lock, ['a', 'b', 'c', 'd', 'e'], () => 'tbl1');
    expect(maxConcurrent).toBe(1);
    expect(order).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('release 后锁表清空，无内存泄漏', async () => {
    const lock = new TableWriteLock();
    const internals = lock as unknown as { locks: Map<string, Promise<void>> };
    for (let i = 0; i < 200; i++) {
      const release = await lock.acquire('tblSame');
      release();
    }
    expect(internals.locks.size).toBe(0);
  });

  it('动态 tableId 全部释放后无残留', async () => {
    const lock = new TableWriteLock();
    const internals = lock as unknown as { locks: Map<string, Promise<void>> };
    for (let i = 0; i < 100; i++) {
      const release = await lock.acquire(`tbl_${i}`);
      release();
    }
    expect(internals.locks.size).toBe(0);
  });

  it('不同 tableId 互不阻塞（跨表并行）', async () => {
    const lock = new TableWriteLock();
    const { maxConcurrent } = await measure(lock, ['a', 'b', 'c'], (n) => `tbl_${n}`);
    expect(maxConcurrent).toBe(3);
  });

  it('release 幂等：重复调用不破坏后续串行', async () => {
    const lock = new TableWriteLock();
    const release = await lock.acquire('tbl1');
    release();
    release();
    release();

    let concurrent = 0;
    let maxConcurrent = 0;
    const task = async () => {
      const r = await lock.acquire('tbl1');
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r2) => setTimeout(r2, 5));
      concurrent -= 1;
      r();
    };
    await Promise.all([task(), task(), task()]);
    expect(maxConcurrent).toBe(1);
  });

  it('持锁期间后继者被阻塞，release 后才进入', async () => {
    const lock = new TableWriteLock();
    const events: string[] = [];
    const releaseA = await lock.acquire('tbl1');
    events.push('a-acquired');
    const b = lock.acquire('tbl1').then((r) => {
      events.push('b-acquired');
      r();
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual(['a-acquired']); // b 仍被阻塞
    releaseA();
    await b;
    expect(events).toEqual(['a-acquired', 'b-acquired']);
  });
});

// ============================================================
// 缺陷 2：Auth 多实例 token 隔离（mock https 捕获真实出站请求）
// ============================================================
vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>();
  const requestLog: Array<{ appId: string; seq: number }> = [];
  let seq = 0;
  const delays: Record<string, number> = {};

  const mockRequest = ((opts: { headers?: Record<string, string> }, cb: unknown) => {
    const req = new EventEmitter() as EventEmitter & {
      write: (d: string) => void;
      end: () => void;
      setTimeout: () => void;
      destroy: () => void;
    };
    let written = '';
    req.write = (d: string) => {
      written += d;
    };
    req.end = () => {
      let appId = 'UNKNOWN';
      try {
        appId = (JSON.parse(written) as { app_id: string }).app_id;
      } catch {
        /* ignore */
      }
      requestLog.push({ appId, seq: seq++ });
      setTimeout(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode: number };
        res.statusCode = 200;
        cb(res);
        res.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              code: 0,
              msg: 'ok',
              tenant_access_token: `TOKEN_OF_${appId}`,
              expire: 7200,
            }),
          ),
        );
        res.emit('end');
      }, delays[appId] ?? 10);
    };
    req.setTimeout = () => req;
    req.destroy = () => undefined;
    return req;
  }) as unknown as typeof actual.request;

  return {
    ...actual,
    default: { ...actual, request: mockRequest },
    request: mockRequest,
    __requestLog: requestLog,
    __delays: delays,
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const httpsMock = await import('https') as any;
const requestLog = httpsMock.__requestLog as Array<{ appId: string; seq: number }>;
const delays = httpsMock.__delays as Record<string, number>;

describe('[FIX 2] Auth 多实例 token 隔离', () => {
  beforeEach(() => {
    requestLog.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('不同 appId 并发刷新：各发一次请求，拿到各自 token（不再串号）', async () => {
    const { Auth } = await import('../src/core/Auth');
    delays.APP_A = 60;
    delays.APP_B = 5;

    const authA = new Auth({ appId: 'APP_A', appSecret: 's', domain: 'https://open.feishu.cn' });
    const authB = new Auth({ appId: 'APP_B', appSecret: 's', domain: 'https://open.feishu.cn' });

    const [tokenA, tokenB] = await Promise.all([authA.getToken(), authB.getToken()]);

    expect(requestLog).toHaveLength(2);
    expect(requestLog.map((r) => r.appId).sort()).toEqual(['APP_A', 'APP_B']);
    expect(tokenA).toBe('TOKEN_OF_APP_A');
    expect(tokenB).toBe('TOKEN_OF_APP_B');
  });

  it('同一 appId 并发刷新仍被 singleFlight 合并为一次请求', async () => {
    const { Auth } = await import('../src/core/Auth');
    const a1 = new Auth({ appId: 'APP_SAME', appSecret: 's', domain: 'https://open.feishu.cn' });
    const a2 = new Auth({ appId: 'APP_SAME', appSecret: 's', domain: 'https://open.feishu.cn' });

    const [t1, t2] = await Promise.all([a1.getToken(), a2.getToken()]);
    expect(requestLog).toHaveLength(1);
    expect(t1).toBe(t2);
  });
});

// ============================================================
// 查询相关缺陷（3/5/8/9）：mock Client
// ============================================================
interface UserRow {
  name: string;
  age: number;
  email: string;
}

const userSchema = new Schema({
  name: { fieldName: '姓名', type: FieldType.Text },
  age: { fieldName: '年龄', type: FieldType.Number },
  email: { fieldName: '邮箱', type: FieldType.Text },
});

const TABLE_ID = 'tblXXX';
const APP_TOKEN = 'appXXX';

function makeRawRecord(recordId: string, fields: Record<string, unknown>) {
  return { record_id: recordId, created_time: 1700000000000, fields };
}

function makeMockClient(searchImpl: (body: Record<string, unknown>, pageToken?: string) => {
  has_more: boolean;
  page_token?: string;
  total?: number;
  items: Array<ReturnType<typeof makeRawRecord>>;
}) {
  const release = vi.fn();
  const request = vi.fn(async (_method: string, path: string, body?: unknown) => {
    const pageToken = new URL(`http://x${path}`).searchParams.get('page_token') ?? undefined;
    return searchImpl((body ?? {}) as Record<string, unknown>, pageToken ?? undefined);
  });
  return {
    client: {
      http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
      request,
      config: { userIdType: 'open_id', serializeWrites: true },
      writeLock: { acquire: vi.fn().mockResolvedValue(release) },
      getAppToken: vi.fn().mockReturnValue(APP_TOKEN),
    } as unknown as Client,
    request,
  };
}

describe('[FIX 3] where() 无值操作符解析', () => {
  it("where('email', 'isEmpty') 编译为 operator=isEmpty, value=[]（而非 is+'isEmpty'）", async () => {
    let captured: Record<string, unknown> = {};
    const { client } = makeMockClient(() => {
      captured = { ...captured };
      return { has_more: false, items: [], total: 0 };
    });
    await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema)
      .where('email', 'isEmpty')
      .findAll();

    const call = (client as unknown as { request: { mock: { calls: unknown[][] } } }).request.mock.calls[0];
    const body = call[2] as { filter?: { conditions: Array<{ field_name: string; operator: string; value: string[] }> } };
    const cond = body.filter?.conditions[0];
    expect(cond).toBeDefined();
    // 【缺陷10回归】飞书 search API 要求 snake_case 键名，camelCase 会被 99992402 拒绝
    expect('field_name' in (cond as object)).toBe(true);
    expect('fieldName' in (cond as object)).toBe(false);
    expect(cond.operator).toBe(FilterOperator.IsEmpty);
    expect(cond.value).toEqual([]);
  });

  it("where('email', 'isNotEmpty') 编译为 operator=isNotEmpty, value=[]", async () => {
    const { client } = makeMockClient(() => ({ has_more: false, items: [], total: 0 }));
    await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema)
      .where('email', 'isNotEmpty')
      .findAll();

    const call = (client as unknown as { request: { mock: { calls: unknown[][] } } }).request.mock.calls[0];
    const body = call[2] as { filter?: { conditions: Array<{ operator: string }> } };
    expect(body.filter?.conditions[0].operator).toBe(FilterOperator.IsNotEmpty);
  });

  it("业务数据本身是 'isEmpty' 字符串时，三参数形式仍按 is 匹配（显式消歧）", async () => {
    const { client } = makeMockClient(() => ({ has_more: false, items: [], total: 0 }));
    await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema)
      .where('name', '=', 'isEmpty')
      .findAll();

    const call = (client as unknown as { request: { mock: { calls: unknown[][] } } }).request.mock.calls[0];
    const body = call[2] as { filter?: { conditions: Array<{ operator: string; value: string[] }> } };
    expect(body.filter?.conditions[0].operator).toBe(FilterOperator.Is);
    expect(body.filter?.conditions[0].value).toEqual(['isEmpty']);
  });

  it('简写形式 where(field, value) 行为不变', async () => {
    const { client } = makeMockClient(() => ({ has_more: false, items: [], total: 0 }));
    await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema).where('name', '张三').findAll();

    const call = (client as unknown as { request: { mock: { calls: unknown[][] } } }).request.mock.calls[0];
    const body = call[2] as { filter?: { conditions: Array<{ operator: string; value: string[] }> } };
    expect(body.filter?.conditions[0].operator).toBe(FilterOperator.Is);
    expect(body.filter?.conditions[0].value).toEqual(['张三']);
  });
});

describe('[FIX 5] findAll() limit 提前终止', () => {
  it('limit(5) 且每页 3 条：只发 2 次请求即停止（原来会拉全表）', async () => {
    // 服务端共 20 条（7 页），每页返回 3 条
    let seq = 0;
    const { client, request } = makeMockClient((_body, pageToken) => {
      const page = pageToken ? Number(pageToken.split('_')[1]) : 0;
      seq += 1;
      const start = page * 3;
      const items = Array.from({ length: 3 }, (_, i) =>
        makeRawRecord(`rec_${start + i}`, { 姓名: `用户${start + i}`, 年龄: 20, 邮箱: '' }),
      );
      return {
        has_more: start + 3 < 20,
        page_token: start + 3 < 20 ? `pt_${page + 1}` : undefined,
        total: 20,
        items,
      };
    });
    void seq;

    const rows = await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema).limit(5).findAll();

    expect(rows).toHaveLength(5);
    expect(request.mock.calls.length).toBe(2); // 3+3=6 ≥ 5，两页即停
  });

  it('无 limit 时仍拉全表', async () => {
    const { client, request } = makeMockClient((_body, pageToken) => {
      const page = pageToken ? Number(pageToken.split('_')[1]) : 0;
      const start = page * 3;
      const items = Array.from({ length: 3 }, (_, i) =>
        makeRawRecord(`rec_${start + i}`, { 姓名: `u${start + i}`, 年龄: 20, 邮箱: '' }),
      );
      return {
        has_more: start + 3 < 9,
        page_token: start + 3 < 9 ? `pt_${page + 1}` : undefined,
        total: 9,
        items,
      };
    });

    const rows = await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema).findAll();
    expect(rows).toHaveLength(9);
    expect(request.mock.calls.length).toBe(3);
  });

  it('有 startsWith 后置过滤 + limit：按「过滤命中数」提前终止，结果正确', async () => {
    const data = ['张三', '李四', '王五', '张飞', '赵六', '张辽', '孙七', '周八', '张九'];
    const { client, request } = makeMockClient((_body, pageToken) => {
      const page = pageToken ? Number(pageToken.split('_')[1]) : 0;
      const start = page * 3;
      const items = data.slice(start, start + 3).map((name, i) =>
        makeRawRecord(`rec_${start + i}`, { 姓名: name, 年龄: 20, 邮箱: '' }),
      );
      return {
        has_more: start + 3 < data.length,
        page_token: start + 3 < data.length ? `pt_${page + 1}` : undefined,
        total: data.length,
        items,
      };
    });

    const rows = await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema)
      .where('name', 'startsWith', '张')
      .limit(3)
      .findAll();

    // 3 个「张」姓分布在第 1/2/3 页（索引 0、3、5...）：0 在第 1 页，3 在第 2 页，5 在第 3 页(索引 3-5 是第 2 页? 索引 3,4,5 -> 第二页含 张飞(3)、张辽(5))
    // 第 1 页含 张三(0)；第 2 页含 张飞(3)、张辽(5) → 2 页凑满 3 条即停
    expect(rows.map((r) => r.name)).toEqual(['张三', '张飞', '张辽']);
    expect(request.mock.calls.length).toBeLessThan(3); // 提前终止，未拉全表
  });
});

describe('[FIX 8] findPage 客户端过滤空页语义', () => {
  it('startsWith 过滤后本页为空但服务端还有匹配时，不再返回「空 items + hasMore=true」', async () => {
    // 第 1 页全是「李」，第 2 页有「张三」
    const pages = [
      { has_more: true, page_token: 'pt_1', items: ['李一', '李二', '李三'] },
      { has_more: false, page_token: undefined, items: ['张三'] },
    ];
    const { client } = makeMockClient((_body, pageToken) => {
      const page = pages[pageToken ? 1 : 0];
      return {
        has_more: page.has_more,
        page_token: page.page_token,
        total: 4,
        items: page.items.map((name, i) =>
          makeRawRecord(`rec_${i}`, { 姓名: name, 年龄: 20, 邮箱: '' }),
        ),
      };
    });

    const result = await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema)
      .where('name', 'startsWith', '张')
      .findPage(3);

    expect(result.items.length).toBeGreaterThan(0); // 不再是空页
    expect(result.items[0].name).toBe('张三');
    expect(result.hasMore).toBe(false);
  });
});

describe('[FIX 9] countExact() 精确计数', () => {
  it('startsWith 下 countExact 与 findAll 口径一致（count() 为近似值）', async () => {
    const data = ['张三', '李四', '张飞', '王五', '张辽'];
    const { client } = makeMockClient((_body, pageToken) => {
      const page = pageToken ? Number(pageToken.split('_')[1]) : 0;
      const start = page * 3;
      const items = data.slice(start, start + 3).map((name, i) =>
        makeRawRecord(`rec_${start + i}`, { 姓名: name, 年龄: 20, 邮箱: '' }),
      );
      return {
        has_more: start + 3 < data.length,
        page_token: start + 3 < data.length ? `pt_${page + 1}` : undefined,
        total: data.length, // 服务端 contains 近似值 = 5
        items,
      };
    });

    const qb = new QueryBuilder<UserRow>(client, TABLE_ID, userSchema).where('name', 'startsWith', '张');
    const exact = await qb.countExact();
    expect(exact).toBe(3); // 张三/张飞/张辽
  });

  it('countExact 不受 limit 截断影响', async () => {
    const data = ['a', 'b', 'c', 'd'];
    const { client } = makeMockClient((_body, pageToken) => {
      const page = pageToken ? Number(pageToken.split('_')[1]) : 0;
      const start = page * 3;
      const items = data.slice(start, start + 3).map((name, i) =>
        makeRawRecord(`rec_${start + i}`, { 姓名: name, 年龄: 20, 邮箱: '' }),
      );
      return {
        has_more: start + 3 < data.length,
        page_token: start + 3 < data.length ? `pt_${page + 1}` : undefined,
        total: data.length,
        items,
      };
    });

    const exact = await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema).limit(2).countExact();
    expect(exact).toBe(4);
  });
});

// ============================================================
// 缺陷 7：Webhook 验签长度不等
// ============================================================
describe('[FIX 7] Webhook 验签长度不等返回 false', () => {
  const baseHeaders = {
    'x-lark-request-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-lark-request-nonce': 'n1',
  };

  it('短签名（长度 < 64）返回 false 而非抛 RangeError', () => {
    expect(() =>
      verifyWebhookSignature('{}', { ...baseHeaders, 'x-lark-signature': 'short' }, { encryptKey: 'k' }),
    ).not.toThrow();
    expect(
      verifyWebhookSignature('{}', { ...baseHeaders, 'x-lark-signature': 'short' }, { encryptKey: 'k' }),
    ).toBe(false);
  });

  it('超长签名（长度 > 64）同样返回 false', () => {
    expect(
      verifyWebhookSignature('{}', { ...baseHeaders, 'x-lark-signature': 'a'.repeat(65) }, { encryptKey: 'k' }),
    ).toBe(false);
  });

  it('长度相等的错误签名返回 false，正确签名返回 true', () => {
    const ts = baseHeaders['x-lark-request-timestamp'];
    const body = '{"hello":"world"}';
    const good = crypto.createHash('sha256').update(ts + 'n1' + 'k' + body).digest('hex');
    expect(
      verifyWebhookSignature(body, { ...baseHeaders, 'x-lark-signature': good }, { encryptKey: 'k' }),
    ).toBe(true);
    const bad = 'f'.repeat(64);
    expect(
      verifyWebhookSignature(body, { ...baseHeaders, 'x-lark-signature': bad }, { encryptKey: 'k' }),
    ).toBe(false);
  });
});

// ============================================================
// 缺陷 6：重试幂等性（真实本地 HTTP 服务器）
// ============================================================
describe('[FIX 6] 重试幂等性', () => {
  let server: http.Server;
  let port = 0;
  const received: string[] = [];
  let script: Array<{ status: number; payload: unknown }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(body);
        const next = script.shift() ?? { status: 200, payload: { code: 0, msg: '', data: {} } };
        res.writeHead(next.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(next.payload));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const mkClient = () => {
    const fakeAuth = { getToken: async () => 'tok', invalidate: () => {}, refreshToken: async () => 'tok' };
    return new HttpClient({
      auth: fakeAuth as unknown as Auth,
      rateLimiterRead: new RateLimiter({ qps: 1000 }),
      rateLimiterWrite: new RateLimiter({ qps: 1000 }),
      maxRetries: 3,
      domain: `http://127.0.0.1:${port}`,
    });
  };

  it('POST（非幂等写）默认不自动重试：限流错误只发 1 次请求并抛出', async () => {
    received.length = 0;
    script = Array.from({ length: 5 }, () => ({
      status: 200,
      payload: { code: 99991400, msg: 'rate limited', data: {} },
    }));
    const hc = mkClient();
    await expect(
      hc.post('/apps/x/tables/t/records', { fields: { 姓名: '张三' } }),
    ).rejects.toThrow(/不自动重试/);
    expect(received).toHaveLength(1);
  });

  it('POST 显式 retryable=true：按原逻辑自动重试至成功', async () => {
    received.length = 0;
    script = [
      { status: 200, payload: { code: 99991400, msg: 'rate limited', data: {} } },
      { status: 200, payload: { code: 0, msg: '', data: { record: { record_id: 'r1', fields: {} } } } },
    ];
    const hc = mkClient();
    const resp = await hc.post('/apps/x/tables/t/records', { fields: {} }, true);
    expect(resp).toEqual({ record: { record_id: 'r1', fields: {} } });
    expect(received).toHaveLength(2);
  });

  it('PUT/DELETE（幂等写）默认不重试，显式 retryable=true 才重试', async () => {
    received.length = 0;
    script = [
      { status: 500, payload: { code: 1254002, msg: 'internal', data: {} } },
      { status: 200, payload: { code: 0, msg: '', data: {} } },
    ];
    const hc = mkClient();
    await expect(hc.put('/apps/x/tables/t/records/r1', { fields: {} })).rejects.toThrow();
    expect(received).toHaveLength(1);

    received.length = 0;
    script = [
      { status: 500, payload: { code: 1254002, msg: 'internal', data: {} } },
      { status: 200, payload: { code: 0, msg: '', data: {} } },
    ];
    await hc.delete('/apps/x/tables/t/records/r1', undefined, true);
    expect(received).toHaveLength(2);
  });

  it('GET（读操作）默认仍自动重试', async () => {
    received.length = 0;
    script = [
      { status: 200, payload: { code: 99991400, msg: 'rate limited', data: {} } },
      { status: 200, payload: { code: 0, msg: '', data: { items: [] } } },
    ];
    const hc = mkClient();
    const data = await hc.get('/apps/x/tables/t/records/search');
    expect(data).toEqual({ items: [] });
    expect(received).toHaveLength(2);
  });

  it('token 失效（99991663）不受 retryable 限制：POST 也会刷新后重试', async () => {
    received.length = 0;
    script = [
      { status: 200, payload: { code: 99991663, msg: 'token expired', data: {} } },
      { status: 200, payload: { code: 0, msg: '', data: { record: { record_id: 'r2', fields: {} } } } },
    ];
    const hc = mkClient();
    const r = await hc.post('/apps/x/tables/t/records', { fields: {} });
    expect(r).toEqual({ record: { record_id: 'r2', fields: {} } });
    expect(received).toHaveLength(2);
  });

  it('不可重试错误（权限）依旧只发 1 次', async () => {
    received.length = 0;
    script = [{ status: 200, payload: { code: 1254302, msg: 'no permission', data: {} } }];
    const hc = mkClient();
    await expect(hc.post('/apps/x/tables/t/records', { fields: {} })).rejects.toThrow();
    expect(received).toHaveLength(1);
  });
});

// ============================================================
// 缺陷 11：deleteMany 请求体键名（飞书要求 records，而非 record_ids）
// ============================================================
describe('[FIX 11] deleteMany 请求体键名', () => {
  it('batch_delete 发送 { records: [...] }（发送 record_ids 会被服务端 99992402 拒绝）', async () => {
    const httpPost = vi.fn().mockResolvedValue({ records: [] });
    const client = {
      http: { get: vi.fn(), post: httpPost, put: vi.fn(), delete: vi.fn() },
      request: vi.fn(),
      config: { userIdType: 'open_id', serializeWrites: true },
      writeLock: { acquire: vi.fn().mockResolvedValue(vi.fn()) },
      getAppToken: vi.fn().mockReturnValue(APP_TOKEN),
    } as unknown as Client;

    await new QueryBuilder<UserRow>(client, TABLE_ID, userSchema).deleteMany(['rec1', 'rec2']);

    expect(httpPost).toHaveBeenCalledTimes(1);
    const body = httpPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.records).toEqual(['rec1', 'rec2']);
    expect('record_ids' in body).toBe(false);
  });
});

// ============================================================
// 其他：where() 对非法输入的校验不回归
// ============================================================
describe('where() 校验不回归', () => {
  it('未知操作符仍抛 BitableValidationError', async () => {
    const { client } = makeMockClient(() => ({ has_more: false, items: [], total: 0 }));
    const qb = new QueryBuilder<UserRow>(client, TABLE_ID, userSchema);
    expect(() => qb.where('name', 'bogusOp', 1)).toThrow(BitableValidationError);
  });
});
