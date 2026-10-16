/**
 * 字段适配器接口与注册表
 *
 * 每个飞书字段类型对应一个 FieldAdapter，负责在「用户侧 JS 值」与「飞书 API 读写格式」之间双向转换。
 * 内置适配器见 ./fieldAdapters.ts；用户可通过注册表覆盖任意内置适配器或为自定义类型注册新适配器。
 *
 * 字段数据结构严格依据 RESEARCH.md 第 4 节。
 */

import type { FieldDefinition, FieldType } from '../types';
import { BitableValidationError } from '../error';

/**
 * 字段适配器接口
 *
 * 实现类需针对某一种 `FieldType`，完成用户侧值与飞书 API 值之间的双向转换。
 * 所有方法在收到 `null` / `undefined` 时：
 * - `serialize` 应返回 `null`（表示清空该字段）；
 * - `deserialize` 应返回 `null`。
 */
export interface FieldAdapter {
  /**
   * 将用户侧 JS 值序列化为飞书 API 写入格式。
   *
   * @param value   用户侧传入的值（可能为 null/undefined）
   * @param fieldDef 字段定义（可读取 uiType、property 等附加配置）
   * @returns 可直接写入飞书 `fields` 对象的值；清空字段时返回 null
   * @throws {BitableValidationError} 只读字段被写入，或值类型不合法
   */
  serialize(value: unknown, fieldDef: FieldDefinition): unknown;

  /**
   * 将飞书 API 读取值反序列化为用户侧 JS 值。
   *
   * @param value   飞书 `fields` 对象中读到的原始值（可能为 null/undefined）
   * @param fieldDef 字段定义
   * @returns 用户侧友好的值；空值时返回 null
   */
  deserialize(value: unknown, fieldDef: FieldDefinition): unknown;

  /**
   * 该字段类型是否只读。
   * 只读字段（公式、查找引用、创建时间、创建人等）调用 `serialize` 应抛错。
   */
  isReadOnly(fieldDef: FieldDefinition): boolean;
}

/**
 * 字段适配器注册表
 *
 * 以 `FieldType` 为键维护适配器实例。默认内置适配器由 `createDefaultRegistry()` 注册；
 * 用户可通过 `register()` 覆盖任意内置类型，实现自定义序列化逻辑。
 */
export class FieldAdapterRegistry {
  /** 内部存储：FieldType -> 适配器 */
  private readonly adapters = new Map<FieldType, FieldAdapter>();

  /**
   * 注册（或覆盖）某字段类型的适配器。
   * 后注册的同名类型会覆盖之前的实现，便于用户自定义扩展。
   *
   * @param type     飞书字段类型枚举值
   * @param adapter  适配器实例
   */
  register(type: FieldType, adapter: FieldAdapter): void {
    this.adapters.set(type, adapter);
  }

  /**
   * 获取某字段类型的适配器。
   *
   * @param type 飞书字段类型枚举值
   * @throws {BitableValidationError} 未注册该类型的适配器
   */
  get(type: FieldType): FieldAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new BitableValidationError(
        `[lark-bitable-db] 未注册字段类型 ${type} 的适配器，请通过 FieldAdapterRegistry.register() 注册`,
      );
    }
    return adapter;
  }

  /**
   * 判断某字段类型是否已注册适配器。
   */
  has(type: FieldType): boolean {
    return this.adapters.has(type);
  }

  /**
   * 移除某字段类型的适配器（主要用于测试）。
   */
  unregister(type: FieldType): void {
    this.adapters.delete(type);
  }
}
