# lark-bitable-db

将飞书多维表格当作低成本后端数据库的 ORM 风格 TypeScript SDK。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

---

## 项目简介

`lark-bitable-db` 是一个零运行时依赖的轻量级 SDK，把飞书多维表格（Bitable）当作数据库使用，提供类 ORM 的链式查询 API：

- **Schema 映射**：用 JS 属性名操作飞书字段，自动处理富文本、人员、附件、关联等复杂类型的序列化/反序列化
- **链式查询**：`where().orderBy().limit().findAll()`，自动分页
- **类型安全**：完整 TypeScript 泛型支持，查询和 CRUD 全部类型推导
- **生产级**：内置令牌桶限流、自动重试、token 缓存、同表写锁、Webhook 验签

> 适合做内部工具、轻量后端、数据看板、自动化脚本——不想维护数据库时，飞书多维表格就是你的数据库。

---

## 特性

- ✅ **零依赖**：仅使用 Node.js 内置 `https`/`http` 模块，不引入任何第三方运行时库
- ✅ **ORM 风格**：`Schema` + `Model` + 链式 `QueryBuilder`，类似 Prisma / Sequelize 的体验
- ✅ **20 种字段适配器**：Text、Number、Select、DateTime、Checkbox、User、Url、Attachment、SingleLink、Formula 等全自动转换
- ✅ **自动分页**：`findAll()` 内部循环 `page_token`，调用方无感
- ✅ **批量操作**：`createMany` / `updateMany` / `deleteMany` 超过 1000 条自动分批
- ✅ **限流保护**：读写双令牌桶，默认读 20 QPS、写 50 QPS，符合飞书官方限制
- ✅ **自动重试**：429 限流、token 过期、网络错误自动指数退避重试
- ✅ **同表写锁**：可选的表级写串行化，避免 1254291 写冲突
- ✅ **异常体系**：9 种结构化异常类，错误码精确映射
- ✅ **Webhook 验签**：SHA-256 签名校验 + AES-256-CBC 解密

---

## 安装

```bash
npm install lark-bitable-db
# 或
pnpm add lark-bitable-db
# 或
yarn add lark-bitable-db
```

> 需要 Node.js >= 18.0.0。

---

## 快速开始

### 1. 初始化客户端

```typescript
import { BitableClient } from 'lark-bitable-db';

const client = new BitableClient({
  appId: 'cli_xxxxxxxxxxxx',      // 飞书开放平台应用 ID
  appSecret: 'xxxxxxxxxxxxxxxx',   // 应用密钥
  appToken: 'bascnxxxxxxxxxxxxx',  // 多维表格 app_token
});
```

### 2. 定义 Schema 和 Model

```typescript
import { Model, Schema, FieldType } from 'lark-bitable-db';

// 定义记录类型（可选，但推荐）
interface UserRow {
  name: string;
  age: number;
  active: boolean;
}

// 定义 Schema：JS 属性名 → 飞书字段名
const userSchema = new Schema({
  name:   { fieldName: '姓名', type: FieldType.Text },
  age:    { fieldName: '年龄', type: FieldType.Number },
  active: { fieldName: '启用', type: FieldType.Checkbox },
});

// 定义 Model：绑定数据表
class UserModel extends Model<UserRow> {
  static tableId = 'tblXXXXXXXX';
  static schema = userSchema;
}

const users = new UserModel(client);
```

### 3. CRUD 操作

```typescript
// Create
const user = await users.query().create({
  name: '张三',
  age: 28,
  active: true,
});
console.log(user.recordId); // recXXXXXXXX

// Read by ID
const found = await users.query().findById(user.recordId);

// Query with conditions
const activeUsers = await users
  .query()
  .where('active', '=', true)
  .where('age', '>', 18)
  .orderBy('age', 'desc')
  .limit(10)
  .findAll();

// Update
await users.query().updateById(user.recordId, { age: 29 });

// Delete
await users.query().deleteById(user.recordId);
```

---

## API 文档

### BitableClient 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `appId` | `string` | **必填** | 应用 ID（`cli_` 开头） |
| `appSecret` | `string` | **必填** | 应用密钥 |
| `appToken` | `string` | **必填** | 多维表格 app_token |
| `domain` | `LarkDomain \| string` | `LarkDomain.Feishu` | 服务域名，国际版用 `LarkDomain.Lark` |
| `readQps` | `number` | `20` | 读接口 QPS 限制 |
| `writeQps` | `number` | `50` | 写接口 QPS 限制 |
| `timeout` | `number` | `30000` | 请求超时（毫秒） |
| `maxRetries` | `number` | `3` | 最大重试次数 |
| `userIdType` | `'open_id' \| 'union_id' \| 'user_id'` | `'open_id'` | user_id_type 参数 |
| `serializeWrites` | `boolean` | `true` | 同表写操作自动串行化 |
| `userAccessToken` | `string` | — | 外部传入的 user_access_token（提供后不再自动获取 tenant token） |
| `debug` | `boolean` | `false` | 调试日志 |

### Schema 定义

```typescript
new Schema({
  // JS 属性名: 字段配置
  title: {
    fieldName: '标题',        // 飞书表中的字段名（必须完全一致）
    type: FieldType.Text,     // 字段类型
    uiType: 'Email',          // 可选，子类型（如 Number/Currency/Progress）
    readonly: false,          // 可选，强制只读
  },
});
```

**字段类型对照表：**

| FieldType | 枚举值 | 写入类型 | 读取类型 | 说明 |
|---|---|---|---|---|
| `Text` | 1 | `string` | `string` | 富文本自动提取纯文本 |
| `Number` | 2 | `number` | `number` | 含 Progress/Currency/Rating |
| `SingleSelect` | 3 | `string` | `string` | 选项名称 |
| `MultiSelect` | 4 | `string[]` | `string[]` | 选项名称数组 |
| `DateTime` | 5 | `Date \| number` | `number` (ms) | Date 对象自动转毫秒戳 |
| `Checkbox` | 7 | `boolean` | `boolean` | |
| `User` | 11 | `string \| string[]` | `PersonInfo[]` | open_id 数组 |
| `Phone` | 13 | `string` | `string` | |
| `Url` | 15 | `{text, link} \| string` | `UrlValue` | |
| `Attachment` | 17 | `string[]` | `AttachmentInfo[]` | file_token 数组 |
| `SingleLink` | 18 | `string[]` | `string[]` | 关联记录 ID |
| `DuplexLink` | 21 | `string[]` | `string[]` | 双向关联 |
| `Location` | 22 | `object` | `LocationValue` | 地理位置 |
| `Lookup` | 19 | —（只读） | `ComputedValue` | 查找引用 |
| `Formula` | 20 | —（只读） | `ComputedValue` | 公式 |
| `CreatedTime` | 1001 | —（只读） | `number` | 创建时间 |
| `ModifiedTime` | 1002 | —（只读） | `number` | 最后修改时间 |
| `CreatedUser` | 1003 | —（只读） | `PersonInfo` | 创建人 |
| `ModifiedUser` | 1004 | —（只读） | `PersonInfo` | 修改人 |
| `AutoNumber` | 1005 | —（只读） | `string` | 自动编号 |

### QueryBuilder 链式 API

通过 `model.query()` 获取 QueryBuilder 实例。

#### where 操作符

| 简写 | 完整枚举 | 含义 |
|---|---|---|
| `=` | `FilterOperator.Is` | 等于 |
| `!=` | `FilterOperator.IsNot` | 不等于 |
| `>` | `FilterOperator.IsGreater` | 大于 |
| `<` | `FilterOperator.IsLess` | 小于 |
| `>=` | `FilterOperator.IsGreaterEqual` | 大于等于 |
| `<=` | `FilterOperator.IsLessEqual` | 小于等于 |
| — | `FilterOperator.Contains` | 包含 |
| — | `FilterOperator.DoesNotContain` | 不包含 |
| — | `FilterOperator.IsEmpty` | 为空 |
| — | `FilterOperator.IsNotEmpty` | 不为空 |
| `startsWith` | — | 前缀匹配（客户端后置过滤） |
| `endsWith` | — | 后缀匹配（客户端后置过滤） |

```typescript
// 简写形式：where(field, value) 等价于 where(field, '=', value)
users.query().where('active', true);

// 完整形式
users.query().where('age', '>', 18);
users.query().where('name', 'contains', '张');
users.query().where('email', 'isEmpty');
```

#### 链式方法

| 方法 | 说明 |
|---|---|
| `.where(field, op, value)` | 添加筛选条件（支持简写 `.where(field, value)`） |
| `.and(sub => sub.where(...))` | 添加 AND 子分组（仅一层嵌套） |
| `.or(sub => sub.where(...))` | 添加 OR 子分组（仅一层嵌套） |
| `.orderBy(field, 'asc' \| 'desc')` | 排序（可多次调用，多字段排序） |
| `.limit(count)` | 限制返回条数（1-500） |
| `.offset(pageToken)` | 设置分页 token |
| `.view(viewId)` | 指定视图 |
| `.select([fieldKeys])` | 仅返回指定字段 |

#### 终端查询方法

| 方法 | 返回值 | 说明 |
|---|---|---|
| `.findAll()` | `Array<T & { recordId }>` | 获取全部匹配记录（自动分页） |
| `.findOne()` | `T & { recordId } \| null` | 获取第一条，无匹配返回 null |
| `.findById(recordId)` | `T & { recordId }` | 按 recordId 查询，不存在抛 `BitableNotFoundError` |
| `.findPage(pageSize?, pageToken?)` | `PaginatedResult<T>` | 单页查询，返回 hasMore/pageToken/total |
| `.count()` | `number` | 匹配记录总数 |

#### 写操作方法

| 方法 | 说明 |
|---|---|
| `.create(data)` | 创建单条记录 |
| `.createMany(dataList)` | 批量创建（>1000 自动分批） |
| `.updateById(recordId, data)` | 按 recordId 更新 |
| `.updateMany([{recordId, data}])` | 批量更新（>1000 自动分批） |
| `.deleteById(recordId)` | 按 recordId 删除 |
| `.deleteMany(recordIds)` | 批量删除（>1000 自动分批） |

### 异常体系

所有异常继承自 `BitableBaseError`，包含 `code`、`message`、`httpStatus`、`requestId`、`rawResponse` 字段。

| 异常类 | 触发条件 | 典型错误码 |
|---|---|---|
| `BitableAuthError` | token 缺失、过期、无效 | 99991661, 99991663 |
| `BitablePermissionError` | scope 不足、无表访问权限 | 99991672, 1254302, 1254303 |
| `BitableRateLimitError` | 触发 API 频率限制 | 99991400, 1254290 |
| `BitableNotFoundError` | app/table/record/field 不存在 | 1254040, 1254041, 1254043, 1254044, 1254045 |
| `BitableValidationError` | 参数错误、filter 语法错误、字段类型错误 | 1254000, 1254001, 1254018, 1254024 |
| `BitableConflictError` | 同表并发写冲突 | 1254291 |
| `BitableNetworkError` | 连接失败、超时、DNS 错误 | 网络层错误, 1255040 |
| `BitableApiError` | 其他未分类 API 错误 | 其余 code |

```typescript
import { BitableNotFoundError, BitableRateLimitError } from 'lark-bitable-db';

try {
  await users.query().findById('rec_xxx');
} catch (err) {
  if (err instanceof BitableNotFoundError) {
    console.log('Record not found');
  } else if (err instanceof BitableRateLimitError) {
    console.log('Retry after', err.retryAfter, 'seconds');
  }
}
```

### Webhook 验签

```typescript
import { verifyWebhookSignature, parseWebhookEvent } from 'lark-bitable-db';

// 验证签名
const valid = verifyWebhookSignature(rawBody, headers, {
  encryptKey: 'your-encrypt-key',
});

// 完整解析（验签 → 解密 → JSON → challenge/token 校验）
const event = parseWebhookEvent(rawBody, headers, {
  encryptKey: 'your-encrypt-key',
  verificationToken: 'your-verification-token',
  enableEncryption: true,
});

if ('challenge' in event) {
  // URL 验证挑战，直接返回 challenge
  console.log(event.challenge);
} else {
  // 业务事件
  console.log(event.header.eventType);
}
```

---

## 边界条件与限制

完整边界条件见 [BOUNDARIES.md](./BOUNDARIES.md)。摘要：

- **无事务**：批量操作原子，但多次 API 调用间无一致性保证
- **无 JOIN**：关联字段仅存 ID，需手动二次查询
- **filter 仅一层嵌套**：不支持深层 and/or 嵌套
- **单页最大 500 条**：批量操作单次最大 1000 条
- **同表并发写会冲突**：SDK 默认开启表级写锁串行化
- **不支持附件上传**：需先调用素材上传接口获取 file_token
- **不支持表/字段结构管理**：v1 仅做记录级 CRUD

---

## 与官方 SDK 的区别

| 维度 | 官方 `@larksuiteoapi/node-sdk` | lark-bitable-db |
|---|---|---|
| 抽象层级 | HTTP API 封装 | ORM 风格（Schema/Model/QueryBuilder） |
| 字段转换 | 原始格式透传 | 自动序列化/反序列化 20 种字段类型 |
| 查询方式 | 手动拼 filter JSON | 链式 `.where().orderBy().limit()` |
| 分页 | 手动循环 page_token | `findAll()` 自动分页 |
| 批量分片 | 手动处理 1000 条上限 | 自动分批 |
| 写冲突 | 不处理 | 内置表级写锁 |
| 限流 | 不处理 | 内置令牌桶 |
| 依赖 | 较多 | 零运行时依赖 |
| 学习曲线 | 需熟悉飞书 API 细节 | 类 ORM，快速上手 |

---

## 开发指南

```bash
# 安装依赖
npm install

# 构建（ESM + CJS）
npm run build

# 运行测试
npm test

# 监听模式
npm run test:watch

# 测试覆盖率
npm run test:coverage

# 类型检查
npm run lint
```

### 目录结构

```
src/
├── index.ts            # 公共 API 导出
├── types/index.ts       # 全部类型定义
├── error/index.ts       # 异常体系
├── utils/index.ts       # 工具函数
├── core/
│   ├── Client.ts        # 主客户端
│   ├── Auth.ts          # token 管理
│   ├── HttpClient.ts    # HTTP 客户端
│   ├── RateLimiter.ts   # 令牌桶限流
│   └── Webhook.ts       # Webhook 验签
├── model/
│   ├── Model.ts         # Model 基类
│   ├── Schema.ts        # Schema 定义与序列化
│   ├── FieldAdapter.ts   # 适配器接口与注册表
│   └── fieldAdapters.ts # 20 种内置适配器
└── query/
    ├── QueryBuilder.ts   # 链式查询 + CRUD
    └── FilterCompiler.ts # filter 编译器
```

---

## License

[MIT](./LICENSE)
