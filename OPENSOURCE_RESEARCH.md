# 飞书多维表格（Lark/Feishu Bitable）开源方案调研报告

> **调研时间**：2026-10-16（Asia/Shanghai, UTC+8）
> **数据来源**：npm Registry API（`registry.npmjs.org/-/v1/search`、`api.npmjs.org/downloads`）、npm 包 tarball 实际解包审查、GitHub Search API（后段触发匿名限流 60 req/hr，star 数为搜索结果快照）
> **下载量口径**：最近 30 天（2026-09-13 ~ 2026-10-12），来自 `api.npmjs.org/downloads/point/last-month`

---

## 1. 调研概览

在 npm 上以 `lark bitable` / `feishu bitable` / `lark base` / `bitable orm` / `lark-sdk` / `bitable` / `larksuite` 等关键词组合检索，共筛出 **约 40 个**与多维表格直接相关的包；在 GitHub 上以 `lark bitable`（103 个仓库）、`feishu bitable orm`（0 个）、`feishu bitable typescript`（7 个）、`feishu base sdk`（4 个）检索。

按定位归类：

| 类别 | 数量 | 代表 |
|---|---|---|
| 官方 SDK / CLI / MCP | 7 | `@larksuiteoapi/node-sdk`、`@lark-base-open/node-sdk`、`@larksuite/cli`、`@larksuiteoapi/lark-mcp` |
| 第三方 JS/TS 服务端封装库 | 5 | `ruindong-feishu-bitable`、`@yuuko1410/feishu-bitable`、`@seekshinedev/lark-node`、`lark-bitable`(poliyka)、`@acring/feishu-bitable-cli` |
| MCP Server（AI Agent 对接） | 8+ | `feishu-bitable-mcp`、`@jesonliu/lark-bitable-mcp`、`lark-lite-mcp`、`@base-mesh/cli`、`feishu-scenarios-mcp` |
| n8n / Node-RED / Activepieces 节点 | 10+ | `n8n-nodes-feishu-plus`、`n8n-nodes-feishubitable`、`n8n-nodes-feishu-table`、`@tangm6666/piece-feishu-readonly` |
| 多维表格前端/插件 SDK | 2 | `@lark-opdev/block-bitable-api`、`@qww0302/use-bitable` |
| 其他语言（Go/Python） | 5+ | `ag9920/bitable-sdk`(Go)、`luw2007/bitable-mysql-driver`(Go)、`HUST-wjc/feishu_tools`(Py)、`leemysw/feishu-docx`(Py) |

**核心结论**：截至 2026-10，**npm 上不存在任何对飞书多维表格做真正 ORM 封装（Schema 定义 + 链式查询 + 字段类型序列化）的库**。`feishu orm` 关键词搜索只返回 Drizzle/MikroORM 等通用 SQL ORM。所有第三方封装都停留在「官方 SDK 之上的薄包装」层面，且维护者普遍是个人项目（月下载量 < 100）。

---

## 2. 官方 SDK 分析

### 2.1 `@larksuiteoapi/node-sdk`（Node.js 官方 SDK）

| 项 | 值 |
|---|---|
| 最新版本 | **1.76.0** |
| 最新发布时间 | **2026-10-16**（调研当天仍在发版，极其活跃） |
| 创建时间 | 2022-08-03 |
| 最近 30 天下载量 | **4,638,306**（绝对主力） |
| 依赖 | `axios`、`qs`、`ws`、`protobufjs`、`lodash.merge/pickby/identity` |
| 仓库 | https://github.com/larksuite/node-sdk |
| 协议 | MIT |
| TypeScript | 有（`./types/index.d.ts`，单文件 32 万行） |

#### 2.1.1 架构

- **单体打包**：`lib/index.js` 一个文件包含全部服务；`types/index.d.ts` 单文件 322,678 行。
- **类继承层级**：SDK 内部用 `Client$1P → Client$1O → … → Client$1z` 约 20 层抽象类继承，每一层挂载一个业务域命名空间（acs、auth、bitable、docx、drive、im…）。最终导出 `Client` 类（`types/index.d.ts:313941`）。
- **调用形态**：扁平语义化调用，`client.<domain>.<resource>.<action>({ data, params, path }, options)`。例如：
  ```ts
  client.bitable.appTableRecord.search({
    data: {
      view_id, field_names, sort: [{ field_name, desc }],
      filter: { conjunction: 'and', conditions: [{ field_name, operator, value: [...] }], children: [...] }
    },
    params: { page_token, page_size, user_id_type },
    path: { app_token, table_id }
  })
  ```
- **返回值**：`Promise<{ code?: number, msg?: string, data?: T }>`。**业务错误（code !== 0）不抛异常**，作为正常 resolve 返回。

#### 2.1.2 HTTP 客户端与鉴权

- **HTTP**：基于 axios 的 `HttpInstance`，可通过 `IClientParams.httpInstance` 注入自定义实例。
- **Token 管理**：内置 `TokenManager`（`lib/index.js:100220`），负责：
  - `tenant_access_token` 缓存（提前 3 分钟过期，避免时钟偏差）
  - `user_access_token` 刷新
  - `AppTicketManager`（企业自建应用的 app_ticket 轮换）
  - **ClientAssertion（无密钥/JWT-bearer）模式**（`ClientAssertionProvider` 接口，2026 年新增）
  - 可注入自定义 `Cache`（`IClientParams.cache` / `disableTokenCache`）
- **错误类型**：`ClientAssertionError`（code/msg）、`AccessTokenError`（statusCode/code/error/errorDescription）、`LarkChannelError`。**业务 API 错误不在此列**。

#### 2.1.3 对多维表格的封装程度

`client.bitable.*` 下资源（`types/index.d.ts:23635` 起）：

- `app`（copy/create/get/update）
- `appTable`（patch/batch_delete/batch_create/create/delete/list）
- `appTableRecord`（batch_delete/batch_create/batch_update/update/create/get/**search**/**list**）
- `appTableView`、`appTableForm`、`appTableField`、`appTableFieldGroup`、`appTableFormField`
- 仪表盘 `appDashboard`、自定义角色 `appRole`、自动化 `appAutomation` 等

**关键发现**：
- `appTableRecord.search` 和 `list` **都提供了 `searchWithIterator` / `listWithIterator`**（`types/index.d.ts:24689, 25070`），返回 `AsyncGenerator<{ items, total }>`，即官方 SDK **已内置自动分页**。
- 但 filter DSL 是**原始嵌套对象**：`{ conjunction: 'and'|'or', conditions: [{field_name, operator, value: string[]}], children: [...] }`，没有链式 builder。
- **字段类型**是一个巨大的联合类型：`Record<string, string | number | boolean | {text?, link?} | {location?, pname?, ...} | Array<{id?, name?, avatar_url?}> | Array<string> | Array<{id?, name?, en_name?, email?}> | Array<{file_token?, name?, type?, size?, url?, tmp_url?}>>`（`types/index.d.ts:24230`）。**没有字段类型的序列化/反序列化**——文本字段返回 `[{text, link}]` 数组，需要调用者自己拆。

#### 2.1.4 限流 / 重试

- **官方 SDK 不做 API 级别的重试和限流**。grep 整个 `lib/index.js`，`retry`/`429`/`Retry-After` 只出现在：
  - API 文档注释里（提示开发者「应使用指数退避」）
  - WebSocket 长连接的 liveness 重连逻辑（`lib/index.js:102400+`）
- 飞书多维表格相关限流码：`99991400`（应用频率限制）、`1254607`、`99991668`（多维表格限流）、`1254290`（内部错误）、`99991663`（超时）——这些都需要调用者自己识别并退避。

#### 2.1.5 可复用性评估

| 能力 | 可复用？ | 说明 |
|---|---|---|
| TokenManager（tenant/user/app_ticket/assertion） | ✅ 直接用 | 成熟，缓存策略正确，无需重造 |
| HttpInstance（axios 封装） | ✅ 可注入 | 可包一层自己的 retry/rate-limit 拦截器 |
| 自动分页 iterator | ✅ 已有 | `searchWithIterator` 可直接用 |
| TS 类型（bitable 资源） | ⚠️ 可参考但不好用 | 字段类型是松散联合，需要自己收窄 |
| filter DSL | ❌ 需要包一层 | 原始嵌套对象，链式 builder 缺失 |
| 字段值序列化 | ❌ 完全缺失 | 需自建 |
| 业务错误抛异常 | ❌ 缺失 | 需在调用层包装 `if (code !== 0) throw` |

**结论：官方 SDK 的底层（鉴权、HTTP、自动分页 iterator）可以直接复用；业务层（Schema、链式查询、字段序列化、错误体系、重试限流）需要在其上自建。**

---

### 2.2 `@lark-base-open/node-sdk`（Bitable 专用官方 SDK）

| 项 | 值 |
|---|---|
| 最新版本 | 1.0.1 |
| 最新发布时间 | **2023-11-29**（接近 3 年未更新，事实弃维护） |
| 最近 30 天下载量 | 468 |
| 依赖 | `axios`、`lodash.get/pick/merge/pickby/identity` |
| 协议 | MIT |

- 这是飞书早期为 Base（多维表格）单独出的服务端 SDK，**使用 `personalBaseToken`（PT token）鉴权**，不需要自建应用，直接用 PT token 操作指定 Base。
- 调用形态与主 SDK 几乎一致：`client.base.appTableRecord.list({ params, path })`。
- **不足**：3 年未发版，filter/record 模型停留在 v1 早期，未跟进 2024-2026 年多维表格新增字段类型（如 Location、AutoNumber 高级配置、DuplexLink 反向更新等）。**不建议新项目使用**，但其「PT token 免自建应用」的鉴权思路值得注意。

### 2.3 `@larksuiteoapi/api` / `core` / `event` / `card` / `simple` / `allcore`（模块化拆分）

- `@larksuiteoapi/api` v1.0.14 最新发布时间为 **2022-01-08**，月下载量约 600，是早期模块化尝试，**已被单体 `@larksuiteoapi/node-sdk` 取代**，不要用。

### 2.4 `@larksuite/cli`（官方 CLI）

- v1.0.98，月下载量 **465,927**，2026-03-28 开源（Go 编写）。这是命令行工具，不是可编程库，但它对 Base URL 解析、app_token/table_id/view_id 提取、PT token 登录等流程有完整实现，可作为参考。

### 2.5 `@larksuiteoapi/lark-mcp`（官方 MCP Server）

- v0.5.1，月下载量 **41,735**，官方 MCP Server，把整个 OpenAPI 暴露给 AI Agent。不是 ORM，但说明官方对 AI 场景的投入方向是「让 LLM 直接调原始 API」，而非提供语义化数据访问层。

---

## 3. 主要第三方项目逐个分析

### 3.1 `ruindong-feishu-bitable`（中文社区最完整的薄包装）

| 项 | 值 |
|---|---|
| 版本 | 2.2.0 |
| 最新发布 | 2026-06-20 |
| 月下载量 | 56 |
| 仓库 | Gitee（`gitee.com/lu-yingdong/ruindong-feishu-bitable`） |
| 语言 | **纯 JavaScript，无 TypeScript 类型** |
| 依赖 | `@larksuiteoapi/node-sdk ^1.35.0`、`p-limit` |
| 协议 | MIT |

**定位**：官方 SDK 之上的「生产化」薄包装，面向批量数据处理场景。

**已具备的能力**（解包 `feiShuBitable.js` 实际审查）：

- ✅ **流式遍历**：`iterRecords(tableId, { fieldNames, pageSize })` 返回 async iterator，大数据量不爆内存
- ✅ **批量自动分片**：batchCreate/batchUpdate/batchDelete 自动按 500 条/片切分
- ✅ **并发控制**：`concurrency` 配置，内部用 `p-limit`
- ✅ **智能重试**：
  - 网络错误码白名单：`ECONNRESET/ETIMEDOUT/ECONNREFUSED/ENETUNREACH/EAI_AGAIN/EPIPE/EHOSTUNREACH/ENOTFOUND`
  - 飞书业务码白名单：`1254290`（内部错误）、`1254607`（限流）、`99991663`（超时）、`99991668`（限流）、`99991400`（服务内部错误）
  - 指数退避 + 抖动
  - 明确区分「记录不存在」（`1254043`）为不可重试错误，支持 `skipNotFound` 降级为逐条执行
- ✅ **结构化错误**：`FeishuApiError extends Error`，带 `feishuCode` / `feishuMsg` / `response`
- ✅ **文件上传/下载**（带重试）
- ✅ **可注入 logger**（默认静默，不 console.log）
- ✅ **构造函数兼容**：v1 位置参数自动 deprecation 警告，v2 选项包形式

**不足**：

- ❌ **无 TypeScript 类型**（`types` 字段为空，`main: feiShuBitable.js`）
- ❌ **无 Schema/Model 定义**——表结构不在代码里声明
- ❌ **无链式查询 builder**——filter 仍然是裸对象
- ❌ **字段序列化是 ad-hoc 的 `transformObject`**：文本数组取首段 `text`，人员/附件数组保留原始结构，没有按字段类型统一处理；写操作时字段值格式仍需调用者自己拼
- ❌ **无 relation（双向关联）字段的自动 join/展开**
- ❌ 个人项目，Gitee 托管，Issue/PR 响应不可预期

**可借鉴**：
- 重试码白名单（网络错误 + 飞书业务码）非常完整，可直接抄
- `skipNotFound` 降级思路（批量分片遇记录不存在时降级为逐条）是真实生产踩坑经验
- `chunkArray` + `p-limit` 的批量并发模板
- 「默认静默、注入 logger」的工程化姿态

---

### 3.2 `@yuuko1410/feishu-bitable`（TypeScript 封装）

| 项 | 值 |
|---|---|
| 版本 | 0.0.5 |
| 最新发布 | 2026-03-23 |
| 月下载量 | 20 |
| 语言 | **TypeScript**（`lib/index.d.ts` 完整导出） |
| 依赖 | `@larksuiteoapi/node-sdk ^1.35.0` |
| 运行时 | Bun + Node |

**定位**：基于官方 SDK 的 TS 类型化薄包装。

**已具备**：

- ✅ **TS 类型完整**：导出 `BitableFieldValue`、`BitableRecord`、`BitableFilterCondition`、`BitableFilterGroup`、`BitableSort`、`BitableTextValue`、`BitableLocationValue`、`BitableMemberValue`、`BitableAttachmentValue` 等
- ✅ **`fetchAllRecords`**（一次性拉全量）、`insertList`、`batchUpdateRecords`、`updateRecords`、`deleteList`
- ✅ **文件上传/下载**
- ✅ **OAuth Client**（`FeishuOAuthClient`，含 `buildOAuthLoginUrl`、token 刷新）——这是少数把 user_access_token 流程也封装的
- ✅ 重试（`maxRetries` / `retryDelayMs`）、并发（`defaultConcurrency`）
- ✅ `Bitable.fromEnv(env)` 静态工厂

**不足**：

- ❌ **无 Schema/Model 定义**——`BitableRecord = Record<string, unknown> & { record_id: string }`，字段值仍是松散联合
- ❌ **无链式查询 builder**——filter/sort 仍是裸对象透传
- ❌ **无 async iterator**——只有 `fetchAllRecords`（全量进内存），大数据量场景不如 ruindong
- ❌ 版本 0.0.5，API 不稳定；无 README 链接到仓库（package.json 无 repository 字段）
- ❌ 字段序列化仍然要调用者自己处理 `BitableTextValue` / `BitableMemberValue` 等联合

**可借鉴**：
- 类型定义文件拆分（`auth.d.ts` / `client.d.ts` / `errors.d.ts` / `types.d.ts` / `utils.d.ts`）的工程结构
- 把 OAuth user_access_token 流程也封进来的思路（如果本项目要支持用户身份操作）

---

### 3.3 `lark-bitable`（poliyka，AI-facing CLI）

| 项 | 值 |
|---|---|
| 版本 | 2.0.2 |
| 最新发布 | 2026-07-07 |
| 月下载量 | 53 |
| 仓库 | https://github.com/poliyka/lark-bitable |
| 语言 | TypeScript（oclif CLI + zod） |
| 依赖 | `@oclif/core`、`@inquirer/prompts`、`@larksuiteoapi/node-sdk ^1.62.1`、`zod ^4`、`cli-table3`、`conf` |

**定位**：面向 AI Agent（Codex/Claude Code）的 bug triage CLI，不是可编程库。

**关键设计**：
- ✅ 用 **zod** 校验 CLI 参数和配置 schema（`whereCriterionSchema = z.object({ field, operator: z.enum(['equals','contains']), value })`）
- ✅ Base URL 解析（从 `https://xxx.feishu.cn/base/xxx?table=tbl&view=vew` 提取 app_token/table_id/view_id）
- ✅ Audit log（每次操作写结构化日志，带 evidence boundary）
- ❌ **filter 是客户端过滤**——`filterRecordsByCriteria(ownerResult.records, criteria)` 是把记录拉回来后在 JS 里筛，**没有下推到飞书 search API 的 filter**。这是一个明显的设计缺陷（大数据量时会拉全表）。
- ❌ 面向特定 bug 表 schema（status/owner/priority），通用性弱

**可借鉴**：
- Base URL 解析正则（从 URL 提取 app_token/table_id/view_id）
- zod 作为 schema 校验层（如果本项目要用 zod 做 Schema 定义，这是参考）
- Audit log / evidence boundary 的 AI 友好输出思路

---

### 3.4 `@seekshinedev/lark-node`

| 项 | 值 |
|---|---|
| 版本 | 1.1.1 |
| 最新发布 | 2026-02-03 |
| 月下载量 | 36 |
| 依赖 | `axios ^0.21.1`（**极其过时，有已知 CVE**）、`dotenv ^10` |
| 仓库 | Bitbucket |

**定位**：最早期的个人封装，直接用 axios 调飞书 OpenAPI，不基于官方 SDK。

**不足**：
- ❌ axios 0.21（2021 年版本，多个 SSRF/ReDoS CVE）
- ❌ 无 TS 类型
- ❌ 自己重新实现 token 管理（重复造轮子，且容易有缓存 bug）
- ❌ 无重试、无批量、无分页封装

**结论**：不要参考。

---

### 3.5 `@acring/feishu-bitable-cli`

- v1.0.4，月下载 72，2026-03-25 发布。命令行工具（commander + dotenv），按 URL 查询记录、下载附件。不是库，无可借鉴的架构。

### 3.6 `feishu-bitable`（MCP Server）

- v1.0.10，月下载 30。MCP server，不是库。

### 3.7 `n8n-nodes-feishu-plus`

- v0.1.2，月下载 59，2026-02-26。n8n 社区节点，宣传「production-grade retry, circuit breaker」。但 n8n 节点是工作流执行器内的封装，不是可复用库。其 retry/circuit breaker 实现思路可参考。

### 3.8 MCP Server 群（`feishu-bitable-mcp` / `@jesonliu/lark-bitable-mcp` / `lark-lite-mcp` / `@base-mesh/cli` / `feishu-scenarios-mcp`）

- 月下载量均在 20-50 之间，全部是 2025-2026 年 AI 热潮下出现的 MCP server，把 bitable 操作包装成 MCP tool。它们的共性是：
  - 不做 Schema，不做链式查询
  - 把 search/list/create/update 直接暴露成 MCP tool，让 LLM 自己拼参数
  - 默认只读（read-only by default），写操作需要显式开启
- **对本项目的启示**：MCP 场景下，调用者是 LLM，参数越结构化越好——这反而强化了「需要 Schema 定义 + 类型安全」的论点。

---

### 3.9 其他语言参考（非 JS，但有设计启发）

#### `luw2007/bitable-mysql-driver`（Go，30 stars，已声明停止维护）

- 试图把飞书多维表格伪装成 MySQL 驱动，让任何 SQL 客户端直接 `SELECT * FROM tbl`。
- **设计启发**：把 Bitable 当「远程表」访问的思路是成立的；但作者自己声明「现代模型可直接操作，无需第三方 SQL/MySQL 驱动」，说明 SQL 方言映射成本高、维护难。**本项目不应走 SQL 驱动路线，而应走 TypeScript ORM 路线**。

#### `ag9920/bitable-sdk`（Go，7 stars）

- 纯 Go 封装官方 API，无 ORM。

#### `HUST-wjc/feishu_tools`（Python，8 stars）

- 非官方 Python SDK，覆盖 Bitable 和 Doc。无 ORM。

#### `leemysw/feishu-docx`（Python，267 stars）

- 飞书文档/表格/Bitable ↔ Markdown 双向导出工具。星数最高，但定位是「导出器」不是「数据访问层」。

---

## 4. 对比表格（项目 × 能力维度）

图例：✅ 具备 / ⚠️ 部分具备 / ❌ 缺失 / N/A 不适用

| 项目 | 版本 | 月下载 | 最后更新 | TS 类型 | Schema/Model | 链式查询 | 自动分页 | 字段类型序列化 | 自动鉴权/Token | 限流/重试 | 统一异常 | 定位 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **@larksuiteoapi/node-sdk** | 1.76.0 | 4,638,306 | 2026-10-16 | ⚠️ 松散 | ❌ | ❌ | ✅ WithIterator | ❌ | ✅ 完整 | ❌ | ⚠️ 业务码不抛 | 官方薄 SDK |
| **@lark-base-open/node-sdk** | 1.0.1 | 468 | 2023-11-29 | ✅ | ❌ | ❌ | ⚠️ 手动 | ❌ | ✅ PT token | ❌ | ⚠️ | 官方 Base SDK（弃维护） |
| **@larksuiteoapi/lark-mcp** | 0.5.1 | 41,735 | 2025-08-06 | ✅ | ❌ | ❌ | ⚠️ | ❌ | ✅ | ❌ | ❌ | 官方 MCP |
| **@larksuite/cli** | 1.0.98 | 465,927 | 2026 | N/A | ❌ | ❌ | N/A | ❌ | ✅ | ❌ | ❌ | 官方 CLI |
| **ruindong-feishu-bitable** | 2.2.0 | 56 | 2026-06-20 | ❌ | ❌ | ❌ | ✅ iterRecords | ⚠️ ad-hoc | ✅ 复用官方 | ✅ 完整重试+并发 | ✅ FeishuApiError | 生产化薄包装 |
| **@yuuko1410/feishu-bitable** | 0.0.5 | 20 | 2026-03-23 | ✅ | ❌ | ❌ | ❌ fetchAll 进内存 | ⚠️ 联合类型 | ✅ + OAuth | ⚠️ 简单重试 | ✅ FeishuBitableError | TS 薄包装 |
| **lark-bitable** (poliyka) | 2.0.2 | 53 | 2026-07-07 | ✅ | ⚠️ zod 仅 CLI 参数 | ❌ 客户端过滤 | ❌ | ❌ | ✅ | ❌ | ❌ | AI CLI |
| **@seekshinedev/lark-node** | 1.1.1 | 36 | 2026-02-03 | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ 自实现 | ❌ | ❌ | 过时薄包装 |
| **@acring/feishu-bitable-cli** | 1.0.4 | 72 | 2026-03-25 | ❌ | N/A | N/A | N/A | ❌ | ⚠️ | ❌ | ❌ | CLI |
| **feishu-bitable-mcp** 等 MCP | 0.1.x | 20-50 | 2026 | ⚠️ | ❌ | ❌ | ⚠️ | ❌ | ✅ | ❌ | ❌ | MCP Server |
| **n8n-nodes-feishu-plus** | 0.1.2 | 59 | 2026-02-26 | ✅ | ❌ | ❌ | ⚠️ | ❌ | ✅ | ✅ retry+熔断 | ❌ | n8n 节点 |
| **luw2007/bitable-mysql-driver** (Go) | — | N/A | 2026-09-17 | N/A | ❌ | SQL 方言 | ⚠️ | ❌ | ✅ | ❌ | ❌ | MySQL 驱动（弃维护） |

---

## 5. 现有方案的共性不足

综合所有项目，可以提炼出 **7 个系统性缺口**——这正是本项目的机会所在：

### 5.1 没有 Schema/Model 定义层
所有库都把表结构留在飞书服务端，代码里只有 `Record<string, unknown>`。开发者不知道某张表有哪些字段、字段类型是什么、哪些是必填。改字段名时编译器不会报错。

### 5.2 没有链式查询 builder
filter 一律是裸嵌套对象 `{ conjunction, conditions: [{field_name, operator, value}] }`。手写这种对象容易出错（operator 拼错、value 必须是 string[]、children 嵌套层级），且没有类型检查——`field_name` 拼错要到运行时才发现。

### 5.3 字段值没有统一的序列化/反序列化
飞书返回的字段值结构极其不规则：
- 文本字段：`[{ text: "hello", link: null }]`（数组！）
- 数字字段：`42`
- 单选字段：`"选项名"`（字符串）
- 多选字段：`["A", "B"]`
- 人员字段：`[{ id, name, en_name, email, avatar_url }]`
- 附件字段：`[{ file_token, name, type, size, url, tmp_url }]`
- 日期字段：`1700000000000`（毫秒时间戳）
- 复选框：`true`
- 关联记录：`["recXXX", "recYYY"]`
- 地理位置：`{ location, pname, cityname, adname, address, name, full_address }`

没有任何库按字段类型做统一转换（比如文本字段自动 join 成 string、日期自动转 Date、人员字段自动取 id 数组）。每个使用者都在自己写 `transformObject`。

### 5.4 业务错误处理不一致
官方 SDK 返回 `{code, msg, data}` 不抛异常；ruindong 抛 `FeishuApiError`；yuuko 抛 `FeishuBitableError`；其他库不抛。没有跨库通用的错误类型体系（比如区分 `RateLimitError` / `NotFoundError` / `PermissionError` / `ValidationError`）。

### 5.5 重试/限流各自重造
官方 SDK 不做；ruindong 自己写了完整的（质量较高）；yuuko 写了简单的；其他库没有。限流码白名单（`99991400` / `1254607` / `99991668` 等）没有成为公共知识。

### 5.6 TypeScript 类型不 ergonomic
官方 SDK 的字段类型是一个 10 个成员的联合，开发者拿到 `record.fields` 后必须自己 `if (Array.isArray(...))` 收窄。没有「根据 Schema 声明推导出 `fields` 的精确类型」这种能力（对比 Prisma / Drizzle 根据 schema 推导出模型类型）。

### 5.7 关联字段（Link/DuplexLink）无开箱支持
飞书多维表格的单向关联（SingleLink）和双向关联（DuplexLink）返回 record_id 数组，但要拿到关联记录的字段值需要二次调用。没有库做自动 join 或 lazy relation。

---

## 6. 本项目可以借鉴的设计点

| 来源 | 可借鉴点 |
|---|---|
| **官方 SDK** | ① 直接复用其 `TokenManager`（tenant/user/app_ticket/assertion 缓存逻辑成熟）；② 复用 `searchWithIterator`/`listWithIterator` 的自动分页；③ 可注入 `httpInstance` 让我们包自己的 axios 拦截器（retry/rate-limit）；④ 复用其 `Cache` 接口抽象 |
| **ruindong-feishu-bitable** | ① 重试码白名单（网络错误 8 个 + 飞书业务码 5 个）；② `chunkArray(500)` + `p-limit(concurrency)` 批量并发模板；③ `skipNotFound` 降级思路（批量分片遇 1254043 时降级为逐条）；④ 「默认静默、注入 logger」工程姿态；⑤ async iterator 流式遍历 |
| **@yuuko1410/feishu-bitable** | ① 类型文件拆分结构（client/errors/types/auth/utils）；② `fromEnv()` 静态工厂；③ OAuth user_access_token 流程封装（如果要支持用户身份）；④ `BitableFieldValue` 联合类型的命名 |
| **poliyka/lark-bitable** | ① Base URL 解析（从 URL 提取 app_token/table_id/view_id）；② zod 作为 schema 校验层；③ Audit log 结构化输出（AI 友好） |
| **Prisma / Drizzle（参考 ORM）** | ① Schema-first：声明模型 → 推导出 TS 类型；② 链式 query builder：`table.where(...).orderBy(...).limit(...).select(...)`；③ 类型安全的字段名（`where: { status: { equals: "Done" } }`） |
| **飞书官方文档** | ① 限流规则（应用级 5 QPS、多维表格单表更严）；② 批量上限（batchCreate/Update 1000 条、batchDelete 500 条、search 单次 500 行）；③ 字段类型 type 数字与 ui_type 字符串映射表 |

---

## 7. 本项目的差异化机会

基于以上调研，本项目（lark-bitable-db）应在以下维度建立差异化：

### 7.1 定位：TypeScript-first 的 Bitable ORM
**不要**做又一个薄包装，而要做「**Schema 声明 → 类型安全的链式查询 → 字段自动序列化 → 生产级重试限流**」的一体化 ORM。对标 Prisma/Drizzle 的 DX，但后端是飞书多维表格。

### 7.2 核心差异化能力（按优先级）

1. **Schema/Model 定义**：用 TS 类 / zod schema / 链式 builder 声明表结构，推导出 `RecordType` 和 `UpdateType`。字段名和字段类型在编译期检查。
2. **类型安全的链式查询 builder**：
   ```ts
   const records = await base.table<Task>()
     .where(f => f.status.equals("Done").and(f.priority.gte(2)))
     .orderBy(f => f.createdAt.desc())
     .limit(100)
     .all();
   // records: Task[]，字段已反序列化（date → Date, user → User[], text → string）
   ```
3. **字段类型序列化层**：内置所有 ui_type（Text/Number/SingleSelect/MultiSelect/DateTime/Checkbox/User/Attachment/Url/Location/SingleLink/DuplexLink/Formula/CreatedTime/ModifiedTime/CreatedUser/ModifiedUser/AutoNumber/Barcode/Progress/Currency/Rating/Phone）的双向转换。
4. **生产级可靠性（站在 ruindong 肩膀上）**：
   - 内置重试（白名单码 + 指数退避 + 抖动）
   - 内置并发控制（p-limit）
   - 内置批量分片（500/1000 自动切）
   - 内置限流（QPS 令牌桶，对齐飞书 5 QPS）
5. **统一异常体系**：`BitableError` 基类 + `BitableRateLimitError` / `BitableNotFoundError` / `BitablePermissionError` / `BitableValidationError` / `BitableNetworkError`，每个都带 `feishuCode`。
6. **复用官方 SDK 底层**：直接 `require('@larksuiteoapi/node-sdk')` 作为 peer dependency，复用其 TokenManager 和 HttpInstance，不重新实现鉴权。
7. **关联字段 lazy resolve**：`task.owner` 返回 `UserRef`，`.load()` 时二次调用；`task.linkedIssues` 返回 `TaskRef[]`，`.load()` 批量取。

### 7.3 不做的事（明确边界）

- ❌ 不做 MCP server（官方 `@larksuiteoapi/lark-mcp` 已做，且 MCP 场景不需要 ORM）
- ❌ 不做 CLI（官方 `@larksuite/cli` 已做）
- ❌ 不做 SQL 驱动（`luw2007/bitable-mysql-driver` 已证明此路不通）
- ❌ 不做 n8n/Node-RED 节点（生态位不同）
- ❌ 不重新实现鉴权（复用官方 SDK 的 TokenManager）

### 7.4 目标用户画像

- 用 Node.js/TypeScript 写业务后端、把飞书多维表格当「轻量数据库/运营后台」的团队
- AI Agent 开发者（需要类型安全的结构化数据访问，而不是让 LLM 拼裸 API 参数）
- 数据迁移/同步脚本作者（需要批量、重试、流式遍历）

---

## 附录 A：调研中访问的关键数据点

| 数据 | 值 | 查询方式 |
|---|---|---|
| `@larksuiteoapi/node-sdk` 月下载 | 4,638,306 | `api.npmjs.org/downloads/point/last-month` |
| `@larksuiteoapi/node-sdk` 最新版 | 1.76.0（2026-10-16） | `registry.npmjs.org/@larksuiteoapi/node-sdk` |
| `@lark-base-open/node-sdk` 最后发布 | 2023-11-29 | registry time 字段 |
| `ruindong-feishu-bitable` 月下载 | 56 | downloads API |
| `@yuuko1410/feishu-bitable` 月下载 | 20 | downloads API |
| `lark-bitable` (poliyka) 月下载 | 53 | downloads API |
| `@larksuite/cli` 月下载 | 465,927 | downloads API |
| `@larksuiteoapi/lark-mcp` 月下载 | 41,735 | downloads API |
| GitHub `lark bitable` 仓库总数 | 103 | GitHub Search API |
| GitHub `feishu bitable orm` 仓库总数 | **0** | GitHub Search API |
| GitHub `feishu bitable typescript` 仓库总数 | 7 | GitHub Search API |

## 附录 B：关键文件路径（本地解包审查）

- 官方 SDK 类型：`scratch/lark-sdk/package/types/index.d.ts`（322,678 行）
  - bitable 命名空间起点：第 23635 行
  - `appTableRecord.searchWithIterator`：第 24689 行
  - `appTableRecord.search`：第 24790 行
  - `TokenManager`（JS）：`scratch/lark-sdk/package/lib/index.js:100220`
- ruindong 源码：`scratch/thirdparty/rd/package/feiShuBitable.js`
- yuuko 类型：`scratch/thirdparty/yk/package/lib/{client,types,errors,auth}.d.ts`
- poliyka filter：`scratch/thirdparty/lb/package/dist/cli/commands/filter.js`
