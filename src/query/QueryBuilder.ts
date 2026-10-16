/**
 * QueryBuilder：链式查询构建器 + CRUD
 *
 * 这是 SDK 的核心类，整合两部分能力：
 *  1. 链式查询构建：where / and / or / orderBy / limit / offset / view / select，
 *     累积查询状态后由 FilterCompiler 编译为飞书 filter/sort JSON；
 *  2. 终端执行与 CRUD：findAll / findPage / findOne / findById / count，
 *     以及 create / createMany / updateById / updateMany / deleteById / deleteMany。
 *
 * 端点与参数严格依据 RESEARCH.md：
 *  - 查询：POST /apps/{app_token}/tables/{table_id}/records/search（读，20 QPS）；
 *  - 单条：GET  .../records/{record_id}；
 *  - 创建：POST .../records；批量创建 POST .../records/batch_create（≤1000/批）；
 *  - 更新：PUT  .../records/{record_id}；批量更新 POST .../records/batch_update（≤1000/批）；
 *  - 删除：DELETE .../records/{record_id}；批量删除 POST .../records/batch_delete（≤1000/批）。
 *
 * 所有写方法在执行前会通过 client.writeLock 对同表写操作串行化。
 */

import type { Client } from '../core/Client';
import type { Schema } from '../model/Schema';
import {
  FilterOperator,
  type BatchCreateResponseData,
  type BatchDeleteResponseData,
  type BatchUpdateResponseData,
  type FilterGroup,
  type GetRecordResponseData,
  type PaginatedResult,
  type RawBitableRecord,
  type SearchRecordsResponseData,
  type SortDirection,
  type SortItem,
} from '../types';
import { BitableNotFoundError, BitableValidationError } from '../error';
import { FilterCompiler, type WhereCondition } from './FilterCompiler';

/** 单次批量操作上限（RESEARCH.md 1.6 / 2.2） */
const BATCH_LIMIT = 1000;
/** 单页最大记录数（RESEARCH.md 2.2） */
const MAX_PAGE_SIZE = 500;
/** findAll 默认每页条数 */
const DEFAULT_PAGE_SIZE = 100;

/** 嵌套分组（and/or 回调产生的子组） */
interface ChildGroup {
  conjunction: 'and' | 'or';
  conditions: WhereCondition[];
}

/** startsWith / endsWith 的客户端后置过滤项（飞书无原生支持） */
interface PostFilter {
  fieldKey: string;
  mode: 'startsWith' | 'endsWith';
  substring: string;
}

/**
 * 链式查询构建器
 *
 * @typeParam T 用户侧记录行类型（不含 recordId，recordId 由反序列化自动附加）
 *
 * @example
 * ```ts
 * const rows = await model.query()
 *   .where('status', 'active')
 *   .where('price', '>', 100)
 *   .or((sub) => sub.where('city', '广州').where('city', '深圳'))
 *   .orderBy('createdAt', 'desc')
 *   .limit(20)
 *   .findAll();
 * ```
 */
export class QueryBuilder<T extends Record<string, unknown>> {
  private readonly client: Client;
  private readonly tableId: string;
  private readonly schema: Schema;
  private readonly compiler: FilterCompiler;

  /** 顶层扁平 where 条件（默认 AND 连接） */
  private conditions: WhereCondition[] = [];
  /** 嵌套子分组（飞书仅支持一层 children） */
  private childGroups: ChildGroup[] = [];
  /** startsWith / endsWith 的客户端后置过滤 */
  private postFilters: PostFilter[] = [];
  /** 排序项（按调用顺序逐层排序） */
  private sortItems: SortItem[] = [];
  /** limit：限制返回条数（1-500） */
  private limitCount?: number;
  /** 分页 token（飞书用 page_token，而非数字 offset） */
  private pageToken?: string;
  /** 视图 ID */
  private viewId?: string;
  /** select 指定的飞书字段名列表 */
  private selectedFieldNames?: string[];

  /**
   * @param client   飞书客户端实例
   * @param tableId  目标数据表 ID
   * @param schema   该表的 Schema 实例
   */
  constructor(client: Client, tableId: string, schema: Schema) {
    this.client = client;
    this.tableId = tableId;
    this.schema = schema;
    this.compiler = new FilterCompiler(schema);
  }

  // ============================================================
  // 链式查询方法（每个都返回 this 以支持链式调用）
  // ============================================================

  /**
   * 添加筛选条件。
   *
   * 支持两种形式：
   *  - 简写：`where('name', '张三')` 等价于 `where('name', 'is', '张三')`；
   *  - 完整：`where('price', '>', 100)`。
   *
   * 支持的操作符字符串：
   *  - `=` → is，`!=` → isNot，`>` → isGreater，`<` → isLess，
   *    `>=` → isGreaterEqual，`<=` → isLessEqual；
   *  - `contains`，`doesNotContain`，`isEmpty`，`isNotEmpty`；
   *  - `startsWith` / `endsWith`：飞书无原生支持，内部用 contains 发起服务端查询，
   *    再在客户端对结果做前缀 / 后缀过滤（注意：count() 在使用这两个操作符时为近似值）。
   *
   * @param fieldKey Schema 中的用户侧属性名
   * @param operator 操作符（FilterOperator 枚举值或上述简写字符串）；
   *                 若省略 value，则该参数被当作匹配值（简写形式）
   * @param value    匹配值（简写形式时省略）
   * @returns this（链式）
   * @throws {BitableValidationError} fieldKey 不存在于 Schema，或操作符不支持
   */
  where(
    fieldKey: string,
    operator: FilterOperator | string,
    value?: unknown,
  ): this {
    // 校验字段存在
    const def = this.schema.getField(fieldKey);
    if (!def) {
      throw new BitableValidationError(
        `where() 失败：Schema 中不存在用户属性「${fieldKey}」`,
        undefined,
        undefined,
        { fieldName: fieldKey },
      );
    }

    let rawOp: FilterOperator | string;
    let val: unknown;
    if (value === undefined) {
      // 简写：where(field, value) → where(field, 'is', value)
      rawOp = FilterOperator.Is;
      val = operator;
    } else {
      rawOp = operator;
      val = value;
    }

    // startsWith / endsWith：飞书无原生支持，服务端用 contains，客户端后置过滤
    if (rawOp === 'startsWith' || rawOp === 'endsWith') {
      this.conditions.push({
        fieldKey,
        operator: FilterOperator.Contains,
        value: val,
      });
      this.postFilters.push({
        fieldKey,
        mode: rawOp,
        substring: String(val),
      });
      return this;
    }

    const op = this.resolveOperator(rawOp);
    this.conditions.push({ fieldKey, operator: op, value: val });
    return this;
  }

  /**
   * 添加一个 AND 子分组。
   *
   * 回调接收一个新的 QueryBuilder，在其上追加的 where 条件会被组合为一个
   * `{ conjunction: 'and', conditions: [...] }` 的 children 节点。
   *
   * 注意：飞书 filter 仅支持一层 children 嵌套，回调内不可再次调用 and()/or()。
   *
   * @param conditions 回调，在子 QueryBuilder 上追加条件
   * @returns this（链式）
   * @throws {BitableValidationError} 回调内出现二次嵌套分组
   */
  and(conditions: (qb: QueryBuilder<T>) => void): this {
    const sub = new QueryBuilder<T>(this.client, this.tableId, this.schema);
    conditions(sub);
    if (sub.childGroups.length > 0) {
      throw new BitableValidationError(
        '飞书 filter 仅支持一层 children 嵌套，请勿在 and()/or() 回调中再次嵌套分组',
      );
    }
    this.childGroups.push({ conjunction: 'and', conditions: [...sub.conditions] });
    this.postFilters.push(...sub.postFilters);
    return this;
  }

  /**
   * 添加一个 OR 子分组。
   *
   * 与 and() 相同，但子组逻辑连接符为 'or'，用于表达
   * `(root 条件) AND (A OR B OR C)` 这类语义。
   *
   * @param conditions 回调，在子 QueryBuilder 上追加条件
   * @returns this（链式）
   * @throws {BitableValidationError} 回调内出现二次嵌套分组
   */
  or(conditions: (qb: QueryBuilder<T>) => void): this {
    const sub = new QueryBuilder<T>(this.client, this.tableId, this.schema);
    conditions(sub);
    if (sub.childGroups.length > 0) {
      throw new BitableValidationError(
        '飞书 filter 仅支持一层 children 嵌套，请勿在 and()/or() 回调中再次嵌套分组',
      );
    }
    this.childGroups.push({ conjunction: 'or', conditions: [...sub.conditions] });
    this.postFilters.push(...sub.postFilters);
    return this;
  }

  /**
   * 添加排序字段。可多次调用实现多字段排序（按调用顺序逐层排序）。
   *
   * @param fieldKey   Schema 中的用户侧属性名
   * @param direction  排序方向，默认 'asc'
   * @returns this（链式）
   * @throws {BitableValidationError} fieldKey 不存在于 Schema
   */
  orderBy(fieldKey: string, direction: SortDirection = 'asc'): this {
    const def = this.schema.getField(fieldKey);
    if (!def) {
      throw new BitableValidationError(
        `orderBy() 失败：Schema 中不存在用户属性「${fieldKey}」`,
        undefined,
        undefined,
        { fieldName: fieldKey },
      );
    }
    this.sortItems.push({ fieldName: def.fieldName, direction });
    return this;
  }

  /**
   * 限制返回条数（1-500）。
   *
   * @param count 返回条数
   * @returns this（链式）
   * @throws {BitableValidationError} count 不在 1-500 范围
   */
  limit(count: number): this {
    if (!Number.isInteger(count) || count < 1 || count > MAX_PAGE_SIZE) {
      throw new BitableValidationError(
        `limit() 失败：count 必须为 1-${MAX_PAGE_SIZE} 的整数，收到 ${count}`,
      );
    }
    this.limitCount = count;
    return this;
  }

  /**
   * 设置分页 token（飞书用 page_token，而非数字 offset）。
   *
   * @param pageToken 上一页返回的 page_token
   * @returns this（链式）
   */
  offset(pageToken: string): this {
    this.pageToken = pageToken;
    return this;
  }

  /**
   * 指定视图。
   *
   * 注意：当 filter 或 sort 非空时，飞书会忽略 view_id（视为对全表数据过滤）。
   *
   * @param viewId 视图 ID（vew 开头）
   * @returns this（链式）
   */
  view(viewId: string): this {
    this.viewId = viewId;
    return this;
  }

  /**
   * 仅返回指定字段（减少响应体积）。
   *
   * @param fieldKeys Schema 中的用户侧属性名列表
   * @returns this（链式）
   * @throws {BitableValidationError} 某个 fieldKey 不存在于 Schema
   */
  select(fieldKeys: string[]): this {
    const names: string[] = [];
    for (const key of fieldKeys) {
      const def = this.schema.getField(key);
      if (!def) {
        throw new BitableValidationError(
          `select() 失败：Schema 中不存在用户属性「${key}」`,
          undefined,
          undefined,
          { fieldName: key },
        );
      }
      names.push(def.fieldName);
    }
    this.selectedFieldNames = names;
    return this;
  }

  // ============================================================
  // 终端查询方法
  // ============================================================

  /**
   * 获取所有匹配记录（自动循环 page_token 直到 has_more=false）。
   *
   * 受 HttpClient 内置的读令牌桶（默认 20 QPS）保护。
   * 若设置了 limit()，结果会被截断到 limit 条。
   *
   * @returns 反序列化后的记录数组（含 recordId）
   */
  async findAll(): Promise<Array<T & { recordId: string }>> {
    const pageSize = Math.min(this.limitCount ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const results: Array<T & { recordId: string }> = [];
    let token: string | undefined = this.pageToken;

    // 循环分页，直到 has_more=false
    for (;;) {
      const data = await this.executeSearch(pageSize, token);
      for (const item of data.items) {
        results.push(this.deserialize(item));
      }
      if (!data.has_more || !data.page_token) break;
      token = data.page_token;
    }

    const filtered = this.applyPostFilters(results);
    if (this.limitCount !== undefined) {
      return filtered.slice(0, this.limitCount);
    }
    return filtered;
  }

  /**
   * 单页查询。
   *
   * @param pageSize  每页条数（1-500），默认使用 limit() 或 20
   * @param pageToken 分页 token；缺省使用 offset() 设置的值
   * @returns 分页结果（items / hasMore / pageToken / total）
   */
  async findPage(
    pageSize?: number,
    pageToken?: string,
  ): Promise<PaginatedResult<T & { recordId: string }>> {
    const size = Math.min(pageSize ?? this.limitCount ?? 20, MAX_PAGE_SIZE);
    const token = pageToken ?? this.pageToken;
    const data = await this.executeSearch(size, token);
    const items = data.items.map((r) => this.deserialize(r));
    return {
      items: this.applyPostFilters(items),
      hasMore: data.has_more,
      pageToken: data.page_token,
      total: data.total,
    };
  }

  /**
   * 获取第一条匹配记录，无匹配时返回 null。
   *
   * 仅取 page_size=1。若使用了 startsWith/endsWith（客户端后置过滤），
   * 则回退为拉取全部后取首条以保证正确性。
   *
   * @returns 首条记录（含 recordId），或 null
   */
  async findOne(): Promise<(T & { recordId: string }) | null> {
    // 存在客户端后置过滤时，直接走 findAll 取首条，避免漏匹配
    if (this.postFilters.length > 0) {
      const all = await this.findAll();
      return all[0] ?? null;
    }
    const data = await this.executeSearch(1, this.pageToken);
    if (data.items.length === 0) return null;
    return this.deserialize(data.items[0]);
  }

  /**
   * 按 recordId 获取单条记录。
   *
   * @param recordId 飞书记录 ID
   * @returns 记录（含 recordId）
   * @throws {BitableNotFoundError} 记录不存在
   */
  async findById(recordId: string): Promise<T & { recordId: string }> {
    const appToken = this.client.getAppToken();
    const path = `/apps/${appToken}/tables/${this.tableId}/records/${recordId}`;
    const data = await this.client.http.get<GetRecordResponseData>(path, {
      user_id_type: this.client.config.userIdType ?? 'open_id',
    });
    if (!data || !data.record) {
      throw new BitableNotFoundError(
        `记录不存在: ${recordId}`,
        undefined,
        undefined,
        { resourceType: 'record' },
      );
    }
    return this.deserialize(data.record);
  }

  /**
   * 获取匹配记录总数。
   *
   * 利用 search 接口的 total 字段，page_size=1 即可拿到总数。
   *
   * 注意：若使用了 startsWith/endsWith（客户端后置过滤），返回的 total 是
   * 服务端 contains 匹配的近似值，而非客户端过滤后的精确值。
   *
   * @returns 匹配记录总数
   */
  async count(): Promise<number> {
    const body = this.buildSearchBody();
    const path = this.buildSearchPath(1, this.pageToken);
    const data = await this.client.request<SearchRecordsResponseData>(
      'POST',
      path,
      body,
      false, // search 是读操作，使用读令牌桶（20 QPS）
    );
    return data.total ?? 0;
  }

  // ============================================================
  // 写入方法（执行前获取同表写锁）
  // ============================================================

  /**
   * 创建单条记录。
   *
   * 端点：POST /apps/{appToken}/tables/{tableId}/records
   * 请求体：`{ fields: schema.serialize(data) }`
   *
   * @param data 记录数据（部分字段即可，只读字段自动忽略）
   * @returns 创建后的记录（含 recordId）
   */
  async create(data: Partial<T>): Promise<T & { recordId: string }> {
    const release = await this.acquireWriteLock();
    try {
      const appToken = this.client.getAppToken();
      const path = `/apps/${appToken}/tables/${this.tableId}/records`;
      const body = { fields: this.schema.serialize(data as Record<string, unknown>) };
      const resp = await this.client.http.post<GetRecordResponseData>(path, body);
      return this.deserialize(resp.record);
    } finally {
      release();
    }
  }

  /**
   * 批量创建记录。超过 1000 条自动分批。
   *
   * 端点：POST .../records/batch_create
   * 请求体：`{ records: [{ fields: ... }, ...] }`
   *
   * @param dataList 记录数据列表
   * @returns 创建后的记录列表（含 recordId），顺序与入参一致
   */
  async createMany(
    dataList: Array<Partial<T>>,
  ): Promise<Array<T & { recordId: string }>> {
    const release = await this.acquireWriteLock();
    try {
      const appToken = this.client.getAppToken();
      const path = `/apps/${appToken}/tables/${this.tableId}/records/batch_create`;
      const all: Array<T & { recordId: string }> = [];

      for (let i = 0; i < dataList.length; i += BATCH_LIMIT) {
        const chunk = dataList.slice(i, i + BATCH_LIMIT);
        const body = {
          records: chunk.map((d) => ({
            fields: this.schema.serialize(d as Record<string, unknown>),
          })),
        };
        const resp = await this.client.http.post<BatchCreateResponseData>(path, body);
        for (const r of resp.records) all.push(this.deserialize(r));
      }
      return all;
    } finally {
      release();
    }
  }

  /**
   * 按 recordId 更新单条记录（部分字段覆盖）。
   *
   * 端点：PUT .../records/{recordId}
   * 请求体：`{ fields: schema.serialize(data) }`
   *
   * @param recordId 目标记录 ID
   * @param data     待更新字段
   * @returns 更新后的记录（含 recordId）
   */
  async updateById(
    recordId: string,
    data: Partial<T>,
  ): Promise<T & { recordId: string }> {
    const release = await this.acquireWriteLock();
    try {
      const appToken = this.client.getAppToken();
      const path = `/apps/${appToken}/tables/${this.tableId}/records/${recordId}`;
      const body = { fields: this.schema.serialize(data as Record<string, unknown>) };
      const resp = await this.client.http.put<GetRecordResponseData>(path, body);
      return this.deserialize(resp.record);
    } finally {
      release();
    }
  }

  /**
   * 批量更新记录。超过 1000 条自动分批。
   *
   * 端点：POST .../records/batch_update
   * 请求体：`{ records: [{ record_id, fields }, ...] }`
   *
   * @param updates 每条含 recordId 与待更新 data
   * @returns 更新后的记录列表（含 recordId）
   */
  async updateMany(
    updates: Array<{ recordId: string; data: Partial<T> }>,
  ): Promise<Array<T & { recordId: string }>> {
    const release = await this.acquireWriteLock();
    try {
      const appToken = this.client.getAppToken();
      const path = `/apps/${appToken}/tables/${this.tableId}/records/batch_update`;
      const all: Array<T & { recordId: string }> = [];

      for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
        const chunk = updates.slice(i, i + BATCH_LIMIT);
        const body = {
          records: chunk.map((u) => ({
            record_id: u.recordId,
            fields: this.schema.serialize(u.data as Record<string, unknown>),
          })),
        };
        const resp = await this.client.http.post<BatchUpdateResponseData>(path, body);
        for (const r of resp.records) all.push(this.deserialize(r));
      }
      return all;
    } finally {
      release();
    }
  }

  /**
   * 按 recordId 删除单条记录。
   *
   * 端点：DELETE .../records/{recordId}
   *
   * @param recordId 目标记录 ID
   * @returns 删除成功返回 true
   */
  async deleteById(recordId: string): Promise<boolean> {
    const release = await this.acquireWriteLock();
    try {
      const appToken = this.client.getAppToken();
      const path = `/apps/${appToken}/tables/${this.tableId}/records/${recordId}`;
      await this.client.http.delete(path);
      return true;
    } finally {
      release();
    }
  }

  /**
   * 批量删除记录。超过 1000 条自动分批。
   *
   * 端点：POST .../records/batch_delete
   * 请求体：`{ record_ids: [...] }`
   *
   * @param recordIds 待删除记录 ID 列表
   * @returns 删除成功返回 true
   */
  async deleteMany(recordIds: string[]): Promise<boolean> {
    const release = await this.acquireWriteLock();
    try {
      const appToken = this.client.getAppToken();
      const path = `/apps/${appToken}/tables/${this.tableId}/records/batch_delete`;

      for (let i = 0; i < recordIds.length; i += BATCH_LIMIT) {
        const chunk = recordIds.slice(i, i + BATCH_LIMIT);
        await this.client.http.post<BatchDeleteResponseData>(path, { record_ids: chunk });
      }
      return true;
    } finally {
      release();
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 构建 search 请求体（filter / sort / field_names / view_id / automatic_fields）。
   *
   * @returns search POST body
   */
  private buildSearchBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      automatic_fields: false,
    };

    if (this.viewId) body.view_id = this.viewId;
    if (this.selectedFieldNames) body.field_names = this.selectedFieldNames;

    if (this.sortItems.length > 0) {
      body.sort = this.sortItems.map((s) => ({
        field_name: s.fieldName,
        desc: s.direction === 'desc',
      }));
    }

    const filterGroup = this.buildFilterGroup();
    if (filterGroup) body.filter = filterGroup;

    return body;
  }

  /**
   * 构建飞书 filter 结构：根 conditions（AND）+ children[] 子分组。
   * 无任何条件时返回 null。
   */
  private buildFilterGroup(): FilterGroup | null {
    if (this.conditions.length === 0 && this.childGroups.length === 0) return null;

    const root = this.compiler.compile(this.conditions, 'and');
    if (this.childGroups.length > 0) {
      root.children = this.childGroups.map((g) =>
        this.compiler.compile(g.conditions, g.conjunction),
      );
    }
    return root;
  }

  /**
   * 构建 search 端点路径（含 query 参数 page_size / page_token / user_id_type）。
   *
   * @param pageSize  每页条数
   * @param pageToken 分页 token
   * @returns 相对 Client.request 的路径（不含 /apps/{appToken} 前缀）
   */
  private buildSearchPath(pageSize: number, pageToken?: string): string {
    const params = new URLSearchParams();
    params.set('page_size', String(pageSize));
    params.set('user_id_type', this.client.config.userIdType ?? 'open_id');
    if (pageToken) params.set('page_token', pageToken);
    return `/tables/${this.tableId}/records/search?${params.toString()}`;
  }

  /**
   * 执行 search API 调用（POST，读令牌桶）。
   *
   * @param pageSize  每页条数
   * @param pageToken 分页 token
   * @returns search 响应 data
   */
  private async executeSearch(
    pageSize: number,
    pageToken?: string,
  ): Promise<SearchRecordsResponseData> {
    const body = this.buildSearchBody();
    const path = this.buildSearchPath(pageSize, pageToken);
    return this.client.request<SearchRecordsResponseData>('POST', path, body, false);
  }

  /**
   * 将飞书原始记录反序列化为用户侧对象（含 recordId）。
   */
  private deserialize(raw: RawBitableRecord): T & { recordId: string } {
    return this.schema.deserialize(raw) as T & { recordId: string };
  }

  /**
   * startsWith / endsWith 的客户端后置过滤。
   */
  private applyPostFilters(
    items: Array<T & { recordId: string }>,
  ): Array<T & { recordId: string }> {
    if (this.postFilters.length === 0) return items;
    return items.filter((item) =>
      this.postFilters.every((pf) => {
        const val = item[pf.fieldKey];
        const str = typeof val === 'string' ? val : val == null ? '' : String(val);
        return pf.mode === 'startsWith'
          ? str.startsWith(pf.substring)
          : str.endsWith(pf.substring);
      }),
    );
  }

  /**
   * 获取同表写锁；config.serializeWrites=false 时直接返回空 release。
   */
  private async acquireWriteLock(): Promise<() => void> {
    if (this.client.config.serializeWrites === false) {
      return () => {};
    }
    return this.client.writeLock.acquire(this.tableId);
  }

  /**
   * 将用户传入的操作符（字符串或枚举值）归一化为 FilterOperator 枚举。
   *
   * @param op 操作符
   * @returns 归一化后的 FilterOperator
   * @throws {BitableValidationError} 不支持的操作符
   */
  private resolveOperator(op: FilterOperator | string): FilterOperator {
    switch (op) {
      case '=':
      case FilterOperator.Is:
        return FilterOperator.Is;
      case '!=':
      case FilterOperator.IsNot:
        return FilterOperator.IsNot;
      case '>':
        return FilterOperator.IsGreater;
      case '<':
        return FilterOperator.IsLess;
      case '>=':
        return FilterOperator.IsGreaterEqual;
      case '<=':
        return FilterOperator.IsLessEqual;
      case FilterOperator.Contains:
        return FilterOperator.Contains;
      case FilterOperator.DoesNotContain:
        return FilterOperator.DoesNotContain;
      case FilterOperator.IsEmpty:
        return FilterOperator.IsEmpty;
      case FilterOperator.IsNotEmpty:
        return FilterOperator.IsNotEmpty;
      default:
        throw new BitableValidationError(`不支持的筛选操作符: ${String(op)}`);
    }
  }
}
