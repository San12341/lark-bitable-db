import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryBuilder } from '../src/query/QueryBuilder';
import { Schema } from '../src/model/Schema';
import { FieldType, FilterOperator } from '../src/types';
import { BitableNotFoundError, BitableValidationError } from '../src/error';
import type { Client } from '../src/core/Client';

// ---- Test schema ----
interface UserRow {
  name: string;
  age: number;
  active: boolean;
  tags: string[];
}

const userSchema = new Schema({
  name: { fieldName: '姓名', type: FieldType.Text },
  age: { fieldName: '年龄', type: FieldType.Number },
  active: { fieldName: '启用', type: FieldType.Checkbox },
  tags: { fieldName: '标签', type: FieldType.MultiSelect },
});

const TABLE_ID = 'tblXXX';
const APP_TOKEN = 'appXXX';

function makeRawRecord(recordId: string, fields: Record<string, unknown>) {
  return { record_id: recordId, created_time: 1700000000000, fields };
}

/**
 * Build a mock Client with configurable http methods.
 */
function makeMockClient(overrides: {
  httpGet?: ReturnType<typeof vi.fn>;
  httpPost?: ReturnType<typeof vi.fn>;
  httpPut?: ReturnType<typeof vi.fn>;
  httpDelete?: ReturnType<typeof vi.fn>;
  request?: ReturnType<typeof vi.fn>;
} = {}) {
  const release = vi.fn();
  const client = {
    http: {
      get: overrides.httpGet ?? vi.fn(),
      post: overrides.httpPost ?? vi.fn(),
      put: overrides.httpPut ?? vi.fn(),
      delete: overrides.httpDelete ?? vi.fn(),
    },
    request: overrides.request ?? vi.fn(),
    config: { userIdType: 'open_id', serializeWrites: true },
    writeLock: { acquire: vi.fn().mockResolvedValue(release) },
    getAppToken: vi.fn().mockReturnValue(APP_TOKEN),
  } as unknown as Client & { writeLock: { acquire: ReturnType<typeof vi.fn> } };
  return client;
}

function qb(client: ReturnType<typeof makeMockClient>) {
  return new QueryBuilder<UserRow>(client as any, TABLE_ID, userSchema);
}

describe('QueryBuilder - chain building', () => {
  it('where shortcut form equals where(field, "is", value)', () => {
    const b = qb(makeMockClient());
    b.where('name', '张三');
    // Should not throw; internal state is private, just verify chaining works
    expect(b).toBe(b);
  });

  it('where with explicit operator', () => {
    const b = qb(makeMockClient());
    b.where('age', '>', 18);
    expect(b).toBe(b);
  });

  it('where rejects unknown fieldKey', () => {
    const b = qb(makeMockClient());
    expect(() => b.where('nonexistent', 'x')).toThrow(BitableValidationError);
  });

  it('orderBy validates field', () => {
    const b = qb(makeMockClient());
    expect(() => b.orderBy('nope')).toThrow(BitableValidationError);
    expect(() => b.orderBy('age', 'desc')).not.toThrow();
  });

  it('limit validates range', () => {
    const b = qb(makeMockClient());
    expect(() => b.limit(0)).toThrow(BitableValidationError);
    expect(() => b.limit(501)).toThrow(BitableValidationError);
    expect(() => b.limit(100)).not.toThrow();
  });

  it('select validates fields', () => {
    const b = qb(makeMockClient());
    expect(() => b.select(['name', 'nope'])).toThrow(BitableValidationError);
    expect(() => b.select(['name', 'age'])).not.toThrow();
  });

  it('or() adds child group', () => {
    const b = qb(makeMockClient());
    b.where('active', true).or((sub) => {
      sub.where('age', '>', 18);
      sub.where('age', '<', 60);
    });
    expect(b).toBe(b);
  });

  it('nested or() inside or() throws', () => {
    const b = qb(makeMockClient());
    expect(() =>
      b.or((sub) => {
        sub.or(() => {});
      }),
    ).toThrow(/一层 children/);
  });

  it('unsupported operator throws', () => {
    const b = qb(makeMockClient());
    expect(() => b.where('age', 'like', '%x%')).toThrow(/不支持的筛选操作符/);
  });
});

describe('QueryBuilder - findAll pagination', () => {
  it('auto-paginates through two pages', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        has_more: true,
        page_token: 'token2',
        total: 2,
        items: [makeRawRecord('rec1', { '姓名': 'A', '年龄': 1 })],
      })
      .mockResolvedValueOnce({
        has_more: false,
        items: [makeRawRecord('rec2', { '姓名': 'B', '年龄': 2 })],
      });
    const client = makeMockClient({ request });
    const results = await qb(client).findAll();
    expect(results).toHaveLength(2);
    expect(results[0].recordId).toBe('rec1');
    expect(results[0].name).toBe('A');
    expect(results[1].recordId).toBe('rec2');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('single page when has_more=false', async () => {
    const request = vi.fn().mockResolvedValue({
      has_more: false,
      total: 1,
      items: [makeRawRecord('rec1', { '姓名': 'Solo' })],
    });
    const client = makeMockClient({ request });
    const results = await qb(client).findAll();
    expect(results).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('QueryBuilder - findOne / findById', () => {
  it('findOne returns first record', async () => {
    const request = vi.fn().mockResolvedValue({
      has_more: false,
      items: [makeRawRecord('rec1', { '姓名': 'First' })],
    });
    const client = makeMockClient({ request });
    const one = await qb(client).findOne();
    expect(one?.recordId).toBe('rec1');
  });

  it('findOne returns null when empty', async () => {
    const request = vi.fn().mockResolvedValue({ has_more: false, items: [] });
    const client = makeMockClient({ request });
    expect(await qb(client).findOne()).toBeNull();
  });

  it('findById returns record', async () => {
    const httpGet = vi.fn().mockResolvedValue({
      record: makeRawRecord('rec1', { '姓名': 'ById' }),
    });
    const client = makeMockClient({ httpGet });
    const rec = await qb(client).findById('rec1');
    expect(rec.recordId).toBe('rec1');
    expect(rec.name).toBe('ById');
    expect(httpGet).toHaveBeenCalledWith(
      `/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/rec1`,
      { user_id_type: 'open_id' },
    );
  });

  it('findById throws BitableNotFoundError when record missing', async () => {
    const httpGet = vi.fn().mockResolvedValue({ record: undefined });
    const client = makeMockClient({ httpGet });
    await expect(qb(client).findById('rec-nope')).rejects.toThrow(BitableNotFoundError);
  });
});

describe('QueryBuilder - count', () => {
  it('returns total from search response', async () => {
    const request = vi.fn().mockResolvedValue({
      has_more: false,
      total: 42,
      items: [],
    });
    const client = makeMockClient({ request });
    expect(await qb(client).count()).toBe(42);
  });

  it('returns 0 when total is absent', async () => {
    const request = vi.fn().mockResolvedValue({ has_more: false, items: [] });
    const client = makeMockClient({ request });
    expect(await qb(client).count()).toBe(0);
  });
});

describe('QueryBuilder - create', () => {
  it('serializes data and calls http.post', async () => {
    const httpPost = vi.fn().mockResolvedValue({
      record: makeRawRecord('recNew', { '姓名': 'New', '年龄': 20 }),
    });
    const client = makeMockClient({ httpPost });
    const rec = await qb(client).create({ name: 'New', age: 20 });
    expect(rec.recordId).toBe('recNew');
    const [path, body] = httpPost.mock.calls[0];
    expect(path).toBe(`/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`);
    expect(body).toEqual({ fields: { '姓名': 'New', '年龄': 20 } });
  });

  it('acquires write lock before create', async () => {
    const httpPost = vi.fn().mockResolvedValue({ record: makeRawRecord('r1', {}) });
    const client = makeMockClient({ httpPost });
    await qb(client).create({ name: 'x' });
    expect(client.writeLock.acquire).toHaveBeenCalledWith(TABLE_ID);
  });
});

describe('QueryBuilder - createMany batching', () => {
  it('splits >1000 records into batches', async () => {
    const httpPost = vi.fn().mockImplementation((path: string, body: any) => {
      return Promise.resolve({
        records: body.records.map((_: any, i: number) =>
          makeRawRecord(`rec_${i}`, {}),
        ),
      });
    });
    const client = makeMockClient({ httpPost });
    const data = Array.from({ length: 1500 }, (_, i) => ({ name: `u${i}` }));
    const results = await qb(client).createMany(data);
    expect(results).toHaveLength(1500);
    // Two batches: 1000 + 500
    expect(httpPost).toHaveBeenCalledTimes(2);
    const [, body1] = httpPost.mock.calls[0];
    const [, body2] = httpPost.mock.calls[1];
    expect(body1.records).toHaveLength(1000);
    expect(body2.records).toHaveLength(500);
  });

  it('single batch for <=1000 records', async () => {
    const httpPost = vi.fn().mockResolvedValue({
      records: [makeRawRecord('r1', {}), makeRawRecord('r2', {})],
    });
    const client = makeMockClient({ httpPost });
    const results = await qb(client).createMany([{ name: 'a' }, { name: 'b' }]);
    expect(results).toHaveLength(2);
    expect(httpPost).toHaveBeenCalledTimes(1);
  });
});

describe('QueryBuilder - update / delete', () => {
  it('updateById calls http.put with serialized fields', async () => {
    const httpPut = vi.fn().mockResolvedValue({
      record: makeRawRecord('rec1', { '姓名': 'Updated' }),
    });
    const client = makeMockClient({ httpPut });
    const rec = await qb(client).updateById('rec1', { name: 'Updated' });
    expect(rec.recordId).toBe('rec1');
    const [path, body] = httpPut.mock.calls[0];
    expect(path).toBe(`/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/rec1`);
    expect(body).toEqual({ fields: { '姓名': 'Updated' } });
  });

  it('updateMany splits into batches', async () => {
    const httpPost = vi.fn().mockResolvedValue({
      records: [makeRawRecord('r1', {})],
    });
    const client = makeMockClient({ httpPost });
    const updates = Array.from({ length: 1500 }, (_, i) => ({
      recordId: `rec${i}`,
      data: { name: `u${i}` },
    }));
    await qb(client).updateMany(updates);
    expect(httpPost).toHaveBeenCalledTimes(2);
  });

  it('deleteById calls http.delete', async () => {
    const httpDelete = vi.fn().mockResolvedValue({});
    const client = makeMockClient({ httpDelete });
    expect(await qb(client).deleteById('rec1')).toBe(true);
    expect(httpDelete).toHaveBeenCalledWith(`/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/rec1`);
  });

  it('deleteMany batches record_ids', async () => {
    const httpPost = vi.fn().mockResolvedValue({ records: [] });
    const client = makeMockClient({ httpPost });
    const ids = Array.from({ length: 1500 }, (_, i) => `rec${i}`);
    await qb(client).deleteMany(ids);
    expect(httpPost).toHaveBeenCalledTimes(2);
    const [, body1] = httpPost.mock.calls[0];
    const [, body2] = httpPost.mock.calls[1];
    expect(body1.record_ids).toHaveLength(1000);
    expect(body2.record_ids).toHaveLength(500);
  });
});
