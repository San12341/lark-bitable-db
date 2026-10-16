/**
 * Schema：记录结构的定义与校验
 *
 * Schema 维护「用户侧 JS 属性名 <-> 飞书字段名」的双向映射，
 * 负责把用户传入的普通对象序列化为飞书 `fields` 对象（仅可写字段），
 * 并把飞书原始记录反序列化为带 recordId 等元信息的用户侧对象。
 *
 * 构造时会：
 *  - 校验飞书字段名不重复；
 *  - 根据字段类型自动标记只读字段（公式、查找引用、创建时间/人等）。
 */

import type {
  FieldDefinition,
  RawBitableRecord,
  SchemaDefinition,
} from '../types';
import { BitableValidationError } from '../error';
import { FieldAdapterRegistry } from './FieldAdapter';
import { defaultRegistry } from './fieldAdapters';

/**
 * Schema 类
 *
 * @example
 * ```ts
 * const schema = new Schema({
 *   title:    { fieldName: '标题', type: FieldType.Text },
 *   price:    { fieldName: '价格', type: FieldType.Number },
 *   owner:    { fieldName: '负责人', type: FieldType.User },
 *   createdAt:{ fieldName: '创建时间', type: FieldType.CreatedTime },
 * });
 * ```
 */
export class Schema {
  /** 用户侧属性名 -> 字段定义 */
  readonly fields: Map<string, FieldDefinition>;

  /** 飞书字段名 -> 用户侧属性名 */
  readonly fieldNameToKey: Map<string, string>;

  /** 适配器注册表（默认使用内置注册表，可传入自定义实例） */
  private readonly registry: FieldAdapterRegistry;

  /**
   * @param definition   Schema 定义：用户属性名 -> 字段配置
   * @param registry     可选的自定义适配器注册表；缺省使用内置默认注册表
   * @throws {BitableValidationError} 飞书字段名重复，或字段类型未注册适配器
   */
  constructor(definition: SchemaDefinition, registry?: FieldAdapterRegistry) {
    this.registry = registry ?? defaultRegistry;
    this.fields = new Map();
    this.fieldNameToKey = new Map();

    for (const [key, def] of Object.entries(definition)) {
      if (!def.fieldName) {
        throw new BitableValidationError(`Schema 字段「${key}」缺少 fieldName 配置`);
      }
      if (this.fieldNameToKey.has(def.fieldName)) {
        throw new BitableValidationError(
          `飞书字段名「${def.fieldName}」重复出现（用户属性：${this.fieldNameToKey.get(def.fieldName)} 与 ${key}）`,
          undefined,
          undefined,
          { fieldName: def.fieldName },
        );
      }
      // 确保该字段类型有适配器
      const adapter = this.registry.get(def.type);
      // 根据字段类型自动标记只读（用户显式设置 readonly=false 时不强制覆盖为 true，
      // 但内置只读类型始终保持只读）
      const enriched: FieldDefinition = {
        ...def,
        readonly: adapter.isReadOnly(def) ? true : def.readonly,
      };
      this.fields.set(key, enriched);
      this.fieldNameToKey.set(def.fieldName, key);
    }
  }

  /**
   * 按用户侧属性名获取字段定义。
   */
  getField(key: string): FieldDefinition | undefined {
    return this.fields.get(key);
  }

  /**
   * 按飞书字段名获取字段定义。
   */
  getFieldByFieldName(fieldName: string): FieldDefinition | undefined {
    const key = this.fieldNameToKey.get(fieldName);
    return key ? this.fields.get(key) : undefined;
  }

  /**
   * 将用户侧对象序列化为飞书 `fields` 对象。
   *
   * - 仅包含数据中实际出现（key in data）的字段；
   * - 自动跳过只读字段（公式、查找引用、创建时间/人等）；
   * - 每个可写字段通过对应适配器序列化。
   *
   * @param data 用户侧对象（部分字段即可）
   * @returns 可直接作为飞书 `fields` 提交的对象，key 为飞书字段名
   */
  serialize(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, def] of this.fields) {
      if (!(key in data)) continue;
      if (def.readonly) continue;
      const adapter = this.registry.get(def.type);
      out[def.fieldName] = adapter.serialize(data[key], def);
    }
    return out;
  }

  /**
   * 将飞书原始记录反序列化为用户侧对象。
   *
   * 输出对象包含：
   *  - `recordId`：飞书 record_id；
   *  - `createdTime` / `createdBy` / `lastModifiedTime` / `lastModifiedBy`（若原始记录携带）；
   *  - 每个 schema 字段对应的用户侧属性名。
   *
   * @param raw 飞书原始记录
   * @returns 用户侧对象
   */
  deserialize(raw: RawBitableRecord): Record<string, unknown> {
    const out: Record<string, unknown> = {
      recordId: raw.record_id,
    };

    // 记录级元信息
    if (raw.created_time !== undefined) out.createdTime = raw.created_time;
    if (raw.created_by !== undefined) out.createdBy = raw.created_by;
    if (raw.last_modified_time !== undefined) out.lastModifiedTime = raw.last_modified_time;
    if (raw.last_modified_by !== undefined) out.lastModifiedBy = raw.last_modified_by;

    const rawFields = raw.fields ?? {};
    for (const [key, def] of this.fields) {
      const adapter = this.registry.get(def.type);
      out[key] = adapter.deserialize(rawFields[def.fieldName], def);
    }
    return out;
  }

  /**
   * 校验单个字段值是否合法（不修改数据，仅触发序列化逻辑做类型检查）。
   *
   * @param key   用户侧属性名
   * @param value 待校验的值
   * @throws {BitableValidationError} 字段不存在、字段只读、或值类型不合法
   */
  validateFieldValue(key: string, value: unknown): void {
    const def = this.fields.get(key);
    if (!def) {
      throw new BitableValidationError(`Schema 中不存在用户属性「${key}」`);
    }
    if (def.readonly) {
      throw new BitableValidationError(
        `字段「${def.fieldName}」为只读字段，不允许写入`,
        undefined,
        undefined,
        { fieldName: def.fieldName },
      );
    }
    const adapter = this.registry.get(def.type);
    // 通过调用 serialize 触发类型校验（结果丢弃）
    adapter.serialize(value, def);
  }
}
