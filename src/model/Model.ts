/**
 * Model：表级 ORM 基类
 *
 * Model 把一个飞书数据表（table_id）与一个 Schema 绑定，
 * 提供字段级别的序列化/反序列化入口。具体的链式查询（where/orderBy/limit/分页）
 * 由 QueryBuilder 模块负责；Model 仅持有 client 与 tableId，并暴露 `query()` 工厂方法。
 *
 * 子类必须设置静态属性 `tableId` 与 `schema`：
 * @example
 * ```ts
 * class BookModel extends Model<BookRow> {
 *   static tableId = 'tblXXXXXXXX';
 *   static schema = new Schema({ ... });
 * }
 * const books = new BookModel(client);
 * ```
 */

import type { RawBitableRecord } from '../types';
import type { Schema } from './Schema';

/**
 * Client 类型：core/Client 模块。
 * Client 实例需具备 `http`（HttpClient）、`config`（BitableConfig）与 `writeLock` 属性。
 */
import type { Client } from '../core/Client';

/**
 * 链式查询构建器（query/QueryBuilder 模块）。
 * 此处导入并以 type 形式重导出，保持 `model` 模块对外 `QueryBuilder` 类型可用。
 */
import { QueryBuilder } from '../query/QueryBuilder';
export type { QueryBuilder };

/**
 * 模型基类
 * @typeParam T 用户侧记录行类型
 */
export abstract class Model<T extends Record<string, unknown>> {
  /** 子类必须覆盖：绑定的数据表 ID */
  static tableId: string;

  /** 子类必须覆盖：该表的 Schema 实例 */
  static schema: Schema;

  /** 飞书客户端实例（具备 http / config） */
  protected readonly client: Client;

  /** 当前模型绑定的 tableId（可被构造参数覆盖静态值） */
  protected readonly tableId: string;

  /**
   * @param client   飞书客户端实例
   * @param tableId   可选覆盖 tableId；缺省使用子类静态 `tableId`
   */
  constructor(client: Client, tableId?: string) {
    this.client = client;
    const ctor = this.constructor as typeof Model;
    this.tableId = tableId ?? ctor.tableId;
  }

  /**
   * 获取当前模型绑定的 tableId。
   */
  getTableId(): string {
    return this.tableId;
  }

  /**
   * 获取当前模型使用的 Schema（子类静态属性）。
   */
  getSchema(): Schema {
    return (this.constructor as typeof Model).schema;
  }

  /**
   * 将用户侧数据对象序列化为飞书 `fields` 对象（委托给 Schema）。
   */
  serialize(data: Partial<T>): Record<string, unknown> {
    return this.getSchema().serialize(data as Record<string, unknown>);
  }

  /**
   * 将飞书原始记录反序列化为用户侧对象（含 recordId 等元信息，委托给 Schema）。
   */
  deserialize(raw: RawBitableRecord): T & { recordId: string } {
    return this.getSchema().deserialize(raw) as T & { recordId: string };
  }

  /**
   * 创建链式查询构造器。
   *
   * 返回的 QueryBuilder 支持 where/and/or/orderBy/limit/offset/view/select 链式调用，
   * 以及 findAll/findPage/findOne/findById/count 查询与
   * create/createMany/updateById/updateMany/deleteById/deleteMany 写操作。
   */
  query(): QueryBuilder<T> {
    return new QueryBuilder<T>(this.client, this.tableId, this.getSchema());
  }
}
