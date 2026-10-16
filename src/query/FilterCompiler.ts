/**
 * FilterCompiler：筛选条件编译器
 *
 * 将 SDK 侧链式 where 调用累积的条件（用户侧属性名 + JS 值），
 * 编译为飞书 POST records/search 接口要求的 filter JSON 结构
 * （见 RESEARCH.md 第 5 节）：
 *
 * ```json
 * {
 *   "conjunction": "and" | "or",
 *   "conditions": [
 *     { "field_name": "标题", "operator": "is", "value": ["xxx"] }
 *   ],
 *   "children": [ { "conjunction": "or", "conditions": [...] } ]
 * }
 * ```
 *
 * 编译过程做两件事：
 *  1. 通过 Schema 把用户侧 fieldKey 映射为飞书 fieldName；
 *  2. 把用户侧 JS 值（number / Date / boolean / 数组）归一化为飞书要求的 string[]。
 *
 * 飞书 filter 仅支持一层 children 嵌套；本编译器只负责「叶子条件组」的编译，
 * 嵌套分组的组装由 QueryBuilder 完成（根 conditions + children[]）。
 */

import { FilterOperator, type FilterCondition, type FilterGroup } from '../types';
import type { Schema } from '../model/Schema';
import { BitableValidationError } from '../error';

/**
 * SDK 侧的单个 where 条件（用户视角）。
 *
 * - `fieldKey` 是 Schema 中定义的用户侧属性名（不是飞书字段名）；
 * - `value` 是用户侧原始 JS 值，由编译器负责转为飞书要求的 string[]。
 */
export interface WhereCondition {
  /** Schema 中的用户侧属性名 */
  fieldKey: string;
  /** 筛选操作符（已由 QueryBuilder 归一化为 FilterOperator 枚举） */
  operator: FilterOperator;
  /** 用户侧原始值（数字 / 字符串 / Date / boolean / 数组等） */
  value: unknown;
}

/**
 * 筛选条件编译器
 *
 * @example
 * ```ts
 * const compiler = new FilterCompiler(schema);
 * const group = compiler.compile(
 *   [{ fieldKey: 'status', operator: FilterOperator.Is, value: 'active' }],
 *   'and',
 * );
 * // => { conjunction: 'and', conditions: [{ field_name: '状态', operator: 'is', value: ['active'] }] }
 * ```
 */
export class FilterCompiler {
  /**
   * @param schema Schema 实例，用于 fieldKey → fieldName 映射
   */
  constructor(private readonly schema: Schema) {}

  /**
   * 将一组扁平条件编译为飞书 FilterGroup。
   *
   * @param conditions 条件列表（用户侧 fieldKey + 原始 value）
   * @param conjunction 该组逻辑连接符：'and' 或 'or'
   * @returns 飞书 filter JSON 结构（不含 children，嵌套分组由调用方组装）
   * @throws {BitableValidationError} 条件中的 fieldKey 在 Schema 中不存在
   */
  compile(
    conditions: WhereCondition[],
    conjunction: 'and' | 'or',
  ): FilterGroup {
    return {
      conjunction,
      conditions: conditions.map((c) => this.compileCondition(c)),
    };
  }

  /**
   * 编译单个条件：字段名映射 + 值归一化。
   *
   * @param cond 用户侧条件
   * @returns 飞书 FilterCondition
   */
  private compileCondition(cond: WhereCondition): FilterCondition {
    const def = this.schema.getField(cond.fieldKey);
    if (!def) {
      throw new BitableValidationError(
        `无法编译筛选条件：Schema 中不存在用户属性「${cond.fieldKey}」`,
        undefined,
        undefined,
        { fieldName: cond.fieldKey },
      );
    }

    return {
      // 飞书 search API 要求 snake_case 键名（field_name），
      // 用 camelCase 会被服务端以 99992402 field validation failed 拒绝
      field_name: def.fieldName,
      operator: cond.operator,
      value: this.convertValue(cond.operator, cond.value),
    };
  }

  /**
   * 把用户侧 JS 值归一化为飞书要求的 string[]。
   *
   * 规则（见 RESEARCH.md 5.3 与任务约定）：
   *  - `isEmpty` / `isNotEmpty`：忽略传入值，固定返回 `[]`；
   *  - `null` / `undefined`：返回 `[]`；
   *  - 数组：展开为多个元素（用于多选 / 人员 / 关联等字段的「或」语义）；
   *  - 标量：按类型转字符串。
   *
   * @param operator 当前操作符
   * @param value 用户侧原始值
   * @returns 飞书 value 字符串数组
   */
  private convertValue(operator: FilterOperator, value: unknown): string[] {
    // 为空 / 不为空：飞书要求 value 必传 []
    if (operator === FilterOperator.IsEmpty || operator === FilterOperator.IsNotEmpty) {
      return [];
    }
    if (value === null || value === undefined) {
      return [];
    }

    // 数组值展开为多个元素（多选 / 人员 / 关联字段的「或」语义）
    if (Array.isArray(value)) {
      return value
        .map((v) => this.scalarToString(v))
        .filter((s) => s.length > 0);
    }

    return [this.scalarToString(value)];
  }

  /**
   * 标量值转字符串：
   *  - Date → 毫秒时间戳字符串；
   *  - number → 数字字符串；
   *  - boolean → "true" / "false"；
   *  - 其他 → String()。
   */
  private scalarToString(value: unknown): string {
    if (value instanceof Date) {
      return String(value.getTime());
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'string') {
      return value;
    }
    return String(value);
  }
}
