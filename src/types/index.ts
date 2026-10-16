/**
 * lark-bitable-db - 核心类型定义
 *
 * 本文件定义 SDK 所有模块共享的类型，是架构的基础。
 * 所有飞书 API 相关的数字和结构均来自官方文档（见 RESEARCH.md）。
 */

// ============================================================
// 1. 配置类型
// ============================================================

/** 飞书服务区域 */
export enum LarkDomain {
  /** 国内版 */
  Feishu = 'https://open.feishu.cn',
  /** 国际版 */
  Lark = 'https://open.larksuite.com',
}

/** SDK 配置 */
export interface BitableConfig {
  /** 应用 ID（cli_ 开头） */
  appId: string;
  /** 应用密钥 */
  appSecret: string;
  /** 多维表格 app_token */
  appToken: string;
  /** 服务域名，默认国内版 */
  domain?: LarkDomain | string;
  /** 读接口 QPS 限制，默认 20 */
  readQps?: number;
  /** 写接口 QPS 限制，默认 50 */
  writeQps?: number;
  /** 请求超时时间（毫秒），默认 30000 */
  timeout?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** user_id_type，默认 open_id */
  userIdType?: 'open_id' | 'union_id' | 'user_id';
  /** 同表写操作是否自动串行化，默认 true */
  serializeWrites?: boolean;
  /** 自定义 user_access_token（如提供则不自动获取 tenant token） */
  userAccessToken?: string;
  /** 是否启用调试日志 */
  debug?: boolean;
}

// ============================================================
// 2. 字段类型定义
// ============================================================

/** 飞书字段 type 枚举（官方数值） */
export enum FieldType {
  Text = 1,
  Number = 2,
  SingleSelect = 3,
  MultiSelect = 4,
  DateTime = 5,
  Checkbox = 7,
  User = 11,
  Phone = 13,
  Url = 15,
  Attachment = 17,
  SingleLink = 18,
  Lookup = 19,
  Formula = 20,
  DuplexLink = 21,
  Location = 22,
  GroupChat = 23,
  Stage = 24,
  CreatedTime = 1001,
  ModifiedTime = 1002,
  CreatedUser = 1003,
  ModifiedUser = 1004,
  AutoNumber = 1005,
  Button = 3001,
}

/** 字段 ui_type 字符串 */
export type FieldUiType =
  | 'Text' | 'Barcode' | 'Email'
  | 'Number' | 'Progress' | 'Currency' | 'Rating'
  | 'SingleSelect' | 'MultiSelect'
  | 'DateTime' | 'Checkbox'
  | 'User' | 'Phone' | 'Url' | 'Attachment'
  | 'SingleLink' | 'Lookup' | 'Formula' | 'DuplexLink'
  | 'Location' | 'GroupChat' | 'Stage'
  | 'CreatedTime' | 'ModifiedTime' | 'CreatedUser' | 'ModifiedUser' | 'AutoNumber'
  | 'Button';

/** 字段属性（property） */
export interface FieldProperty {
  /** 单选/多选选项 */
  options?: Array<{ id?: string; name: string; color?: number }>;
  /** 数字格式化 */
  formatter?: string;
  /** 日期格式 */
  dateFormatter?: string;
  /** 货币代码 */
  currencyCode?: string;
  /** 评分配置 */
  rating?: { symbol?: string };
  /** 进度范围 */
  rangeCustomize?: boolean;
  min?: number;
  max?: number;
  /** 人员是否多选 */
  multiple?: boolean;
  /** 关联表 ID */
  tableId?: string;
  /** 双向关联回字段名 */
  backFieldName?: string;
  /** 公式表达式 */
  formulaExpression?: string;
  /** 自动编号配置 */
  autoSerial?: { type: 'custom' | 'auto_increment_number'; options?: Record<string, unknown> };
  /** 地理位置输入类型 */
  inputType?: 'only_mobile' | 'not_limit';
  [key: string]: unknown;
}

/** Schema 中用户定义的字段配置 */
export interface FieldDefinition {
  /** 飞书字段名（必须与表中字段名完全一致） */
  fieldName: string;
  /** 字段类型 */
  type: FieldType;
  /** ui_type（用于区分同 type 的子类型，如 Number/Currency/Progress） */
  uiType?: FieldUiType;
  /** 是否只读（公式、查找引用、创建时间等自动设置） */
  readonly?: boolean;
  /** 字段描述 */
  description?: string;
}

/** Schema 定义：字段名（用户侧 JS 属性名）→ 字段定义 */
export type SchemaDefinition = Record<string, FieldDefinition>;

// ============================================================
// 3. 查询类型
// ============================================================

/** 筛选操作符（飞书官方支持的操作符） */
export enum FilterOperator {
  /** 等于 */
  Is = 'is',
  /** 不等于 */
  IsNot = 'isNot',
  /** 包含 */
  Contains = 'contains',
  /** 不包含 */
  DoesNotContain = 'doesNotContain',
  /** 为空 */
  IsEmpty = 'isEmpty',
  /** 不为空 */
  IsNotEmpty = 'isNotEmpty',
  /** 大于 */
  IsGreater = 'isGreater',
  /** 大于等于 */
  IsGreaterEqual = 'isGreaterEqual',
  /** 小于 */
  IsLess = 'isLess',
  /** 小于等于 */
  IsLessEqual = 'isLessEqual',
}

/** 单个筛选条件（飞书 search API 要求 snake_case 键名） */
export interface FilterCondition {
  /** 飞书字段名 */
  field_name: string;
  /** 操作符 */
  operator: FilterOperator;
  /** 值（字符串数组，飞书 API 要求） */
  value: string[];
}

/** 筛选组（支持一层嵌套） */
export interface FilterGroup {
  /** 逻辑连接符 */
  conjunction: 'and' | 'or';
  /** 条件列表 */
  conditions: FilterCondition[];
  /** 子筛选组（仅一层嵌套） */
  children?: FilterGroup[];
}

/** 排序方向 */
export type SortDirection = 'asc' | 'desc';

/** 排序项 */
export interface SortItem {
  fieldName: string;
  direction: SortDirection;
}

/** 查询选项 */
export interface QueryOptions {
  /** 视图 ID */
  viewId?: string;
  /** 仅返回指定字段 */
  fieldNames?: string[];
  /** 筛选条件 */
  filter?: FilterGroup;
  /** 排序 */
  sort?: SortItem[];
  /** 每页条数（1-500） */
  pageSize?: number;
  /** 分页 token */
  pageToken?: string;
  /** 是否返回自动字段（创建时间等），默认 false */
  automaticFields?: boolean;
}

/** 分页结果 */
export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  pageToken?: string;
  total?: number;
}

// ============================================================
// 4. 记录类型
// ============================================================

/** 飞书原始记录 */
export interface RawBitableRecord {
  record_id: string;
  created_time?: number;
  created_by?: { id: string; name?: string; [key: string]: unknown };
  last_modified_time?: number;
  last_modified_by?: { id: string; name?: string; [key: string]: unknown };
  fields: Record<string, unknown>;
}

/** 飞书 API 统一响应信封 */
export interface BitableApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

/** 查询记录响应 data */
export interface SearchRecordsResponseData {
  has_more: boolean;
  page_token?: string;
  total?: number;
  items: RawBitableRecord[];
}

/** 批量创建响应 data */
export interface BatchCreateResponseData {
  records: RawBitableRecord[];
}

/** 批量更新响应 data */
export interface BatchUpdateResponseData {
  records: RawBitableRecord[];
}

/** 批量删除响应 data */
export interface BatchDeleteResponseData {
  records: Array<{ record_id: string; deleted: boolean }>;
}

/** 单条记录响应 data */
export interface GetRecordResponseData {
  record: RawBitableRecord;
}

// ============================================================
// 5. 人员/附件等复杂值类型
// ============================================================

/** 人员信息 */
export interface PersonInfo {
  id: string;
  name?: string;
  enName?: string;
  avatarUrl?: string;
  email?: string;
}

/** 附件信息 */
export interface AttachmentInfo {
  fileToken: string;
  name?: string;
  type?: string;
  size?: number;
  url?: string;
  tmpUrl?: string;
}

/** 超链接 */
export interface UrlValue {
  text: string;
  link: string;
}

/** 关联记录值 */
export interface LinkValue {
  linkRecordIds: string[];
}

/** 地理位置 */
export interface LocationValue {
  location?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
  address?: string;
  name?: string;
  fullAddress?: string;
}

/** 公式/查找引用返回值 */
export interface ComputedValue {
  type: number;
  uiType: string;
  value: unknown[];
}

// ============================================================
// 6. 错误类型
// ============================================================

/** 飞书错误码常量 */
export enum BitableErrorCode {
  // 通用鉴权
  MissingToken = 99991661,
  TokenInvalid = 99991663,
  MissingScope = 99991672,
  RateLimit = 99991400,
  // 多维表格业务
  WrongRequestJson = 1254000,
  WrongRequestBody = 1254001,
  InternalError = 1254002,
  WrongBaseToken = 1254003,
  WrongTableId = 1254004,
  WrongViewId = 1254005,
  WrongRecordId = 1254006,
  WrongFieldId = 1254009,
  InvalidPageSize = 1254011,
  InvalidSort = 1254016,
  InvalidFilter = 1254018,
  InvalidFieldNames = 1254024,
  TooLargeResponse = 1254030,
  BaseTokenNotFound = 1254040,
  TableIdNotFound = 1254041,
  ViewIdNotFound = 1254042,
  RecordIdNotFound = 1254043,
  FieldIdNotFound = 1254044,
  FieldNameNotFound = 1254045,
  RecordLimitExceeded = 1254103,
  BatchLimitExceeded = 1254104,
  FilterTooLong = 1254107,
  SortTooLong = 1254108,
  CellTooLarge = 1254130,
  TooManyRequest = 1254290,
  WriteConflict = 1254291,
  PermissionDenied = 1254302,
  AttachPermNotAllow = 1254303,
  DataNotReady = 1254607,
  RequestTimeout = 1255040,
}

// ============================================================
// 7. HTTP 客户端类型
// ============================================================

/** HTTP 请求方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** HTTP 请求配置 */
export interface HttpRequestOptions {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  /** 是否为写操作（影响限流桶选择） */
  isWrite?: boolean;
  /**
   * 是否允许对网络错误/限流等可重试错误自动重试。
   * 默认：读操作为 true，写操作为 false（避免 create 等非幂等操作重复执行）。
   * token 过期重试不受此开关限制（请求被服务端拒绝，重试安全）。
   * 幂等写操作（update/delete）可显式设为 true。
   */
  retryable?: boolean;
}

/** HTTP 响应 */
export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

// ============================================================
// 8. 限流类型
// ============================================================

/** 令牌桶配置 */
export interface RateLimiterOptions {
  /** 每秒允许的请求数 */
  qps: number;
  /** 桶容量（突发量），默认等于 qps */
  burst?: number;
}

// ============================================================
// 9. Webhook 类型
// ============================================================

/** Webhook 事件回调（schema 2.0） */
export interface BitableWebhookEvent {
  schema: string;
  header: {
    eventId: string;
    eventType: string;
    createTime: string;
    token: string;
    appId: string;
    tenantKey: string;
  };
  event: {
    fileType: string;
    fileToken: string;
    tableId: string;
    revision: number;
    operatorId: {
      unionId?: string;
      userId?: string;
      openId?: string;
    };
  };
}

/** Webhook 验签配置 */
export interface WebhookVerifyOptions {
  /** Encrypt Key（开发者后台配置） */
  encryptKey: string;
  /** Verification Token（可选，较弱的校验方式） */
  verificationToken?: string;
  /** 是否启用 AES 解密 */
  enableEncryption?: boolean;
}
