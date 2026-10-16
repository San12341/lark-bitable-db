/**
 * model 模块导出
 *
 * 提供 Schema、Model 基类、字段适配器接口与注册表，以及全部内置字段适配器。
 *
 * @example
 * ```ts
 * import { Model, Schema, FieldType } from 'lark-bitable-db';
 *
 * const schema = new Schema({
 *   title: { fieldName: '标题', type: FieldType.Text },
 * });
 *
 * class Book extends Model<{ title: string | null }> {
 *   static tableId = 'tblxxx';
 *   static schema = schema;
 * }
 * ```
 */

// 接口与注册表
export type { FieldAdapter } from './FieldAdapter';
export { FieldAdapterRegistry } from './FieldAdapter';

// Schema 与 Model 基类
export { Schema } from './Schema';
export { Model, type QueryBuilder } from './Model';

// 内置适配器注册表工厂与默认单例
export {
  createDefaultRegistry,
  defaultRegistry,
} from './fieldAdapters';

// 全部内置字段适配器（命名导出，便于用户覆盖单个类型）
export {
  textAdapter,
  numberAdapter,
  singleSelectAdapter,
  multiSelectAdapter,
  dateTimeAdapter,
  checkboxAdapter,
  userAdapter,
  phoneAdapter,
  urlAdapter,
  attachmentAdapter,
  singleLinkAdapter,
  duplexLinkAdapter,
  lookupAdapter,
  formulaAdapter,
  locationAdapter,
  createdTimeAdapter,
  modifiedTimeAdapter,
  createdUserAdapter,
  modifiedUserAdapter,
  autoNumberAdapter,
} from './fieldAdapters';
