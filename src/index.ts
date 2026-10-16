/**
 * lark-bitable-db - 飞书多维表格 ORM 风格数据库 SDK
 *
 * 将飞书多维表格当作低成本后端数据库，提供类 ORM 的链式查询 API。
 *
 * @example
 * ```typescript
 * import { BitableClient, Model, Schema, FieldType } from 'lark-bitable-db';
 *
 * const client = new BitableClient({
 *   appId: 'cli_xxx',
 *   appSecret: 'xxx',
 *   appToken: 'bascnxxx',
 * });
 *
 * const userSchema = new Schema({
 *   name: { fieldName: '姓名', type: FieldType.Text },
 *   age: { fieldName: '年龄', type: FieldType.Number },
 * });
 *
 * class UserModel extends Model<{ name: string; age: number }> {
 *   static tableId = 'tblxxx';
 *   static schema = userSchema;
 * }
 *
 * const users = new UserModel(client);
 * const all = await users.query().where('age', '>', 18).findAll();
 * ```
 */

// 核心
export { Client as BitableClient } from './core/Client';
export { Auth } from './core/Auth';
export { HttpClient } from './core/HttpClient';
export { RateLimiter } from './core/RateLimiter';
export { verifyWebhookSignature, decryptWebhookBody, parseWebhookEvent } from './core/Webhook';

// 模型
export { Model } from './model/Model';
export { Schema } from './model/Schema';
export { FieldAdapterRegistry } from './model/FieldAdapter';
export type { FieldAdapter } from './model/FieldAdapter';
export { defaultRegistry, createDefaultRegistry } from './model/fieldAdapters';

// 查询
export { QueryBuilder } from './query/QueryBuilder';
export { FilterCompiler } from './query/FilterCompiler';
export type { WhereCondition } from './query/FilterCompiler';

// 异常
export {
  BitableBaseError,
  BitableAuthError,
  BitablePermissionError,
  BitableRateLimitError,
  BitableNotFoundError,
  BitableValidationError,
  BitableConflictError,
  BitableNetworkError,
  BitableApiError,
  createErrorFromCode,
  isRetryableCode,
} from './error';

// 类型
export {
  LarkDomain,
  FieldType,
  FilterOperator,
  BitableErrorCode,
} from './types';
export type {
  BitableConfig,
  FieldUiType,
  FieldDefinition,
  SchemaDefinition,
  FieldProperty,
  FilterCondition,
  FilterGroup,
  SortItem,
  SortDirection,
  QueryOptions,
  PaginatedResult,
  RawBitableRecord,
  BitableApiResponse,
  PersonInfo,
  AttachmentInfo,
  UrlValue,
  LinkValue,
  LocationValue,
  ComputedValue,
  HttpMethod,
  HttpRequestOptions,
  HttpResponse,
  RateLimiterOptions,
  BitableWebhookEvent,
  WebhookVerifyOptions,
} from './types';
