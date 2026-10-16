# 飞书多维表格（Bitable / Base）官方 API 深度调研

> 本文档所有端点、字段结构、数字、错误码均来自飞书开放平台官方文档（open.feishu.cn / open.larkoffice.com / open.larksuite.com），调研时间为 2026-10-16。
> 基础路径（Base Path）：`https://{域名}/open-apis/bitable/v1`
> 统一响应信封：`{ "code": int, "msg": string, "data": {...} }`，`code=0` 表示成功，非 0 为错误。

---

## 1. 全部 API 端点及请求/响应结构

来源：
- 多维表格概述（方法列表）：https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview?lang=zh-CN
- 数据结构概述：https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-structure?lang=zh-CN

路径参数约定：
- `app_token`：多维表格 App 唯一标识（示例 `bascnCMII2ORej2RItqpZZUNMIe`）
- `table_id`：数据表唯一标识（示例 `tblxI2tWaxP5dG7p`）
- `view_id`：视图唯一标识（示例 `vewqhz51lk`）
- `record_id`：记录唯一标识
- `field_id`：字段唯一标识（示例 `fldYWaldeW`）

### 1.1 App（多维表格应用）

| 操作 | HTTP 方法 | 完整 URL 路径 |
|---|---|---|
| 创建多维表格 | POST | `/open-apis/bitable/v1/apps` |
| 复制多维表格 | POST | `/open-apis/bitable/v1/apps/:app_token/copy` |
| 获取多维表格元数据 | GET | `/open-apis/bitable/v1/apps/:app_token` |
| 更新多维表格元数据 | PUT | `/open-apis/bitable/v1/apps/:app_token` |

### 1.2 Table（数据表）

| 操作 | HTTP 方法 | 完整 URL 路径 | 备注 |
|---|---|---|---|
| 列出数据表 | GET | `/open-apis/bitable/v1/apps/:app_token/tables` | 频率 20 次/秒 |
| 新增数据表 | POST | `/open-apis/bitable/v1/apps/:app_token/tables` | |
| 新增多个数据表 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/batch_create` | |
| 删除数据表 | DELETE | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id` | |
| 删除多个数据表 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/batch_delete` | |

列出数据表响应（节选）：`data.tables[]`（含 `table_id`、`name`）、`data.has_more`、`data.page_token`。

### 1.3 View（视图）

| 操作 | HTTP 方法 | 完整 URL 路径 |
|---|---|---|
| 列出视图 | GET | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/views` |
| 新增视图 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/views` |
| 更新视图 | PATCH | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/views/:view_id` |
| 检索视图 | GET | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/views/:view_id` |
| 删除视图 | DELETE | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/views/:view_id` |

视图结构：`view_id`、`view_name`、`view_type`（grid/kanban/gallery/gantt/form）。

### 1.4 Record（记录）—— 核心

| 操作 | HTTP 方法 | 完整 URL 路径 | 频率 |
|---|---|---|---|
| 列出记录（旧版，不推荐） | GET | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records` | 20 次/秒 |
| 查询/检索记录（推荐） | POST | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/search` | 20 次/秒 |
| 获取单条记录 | GET | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id` | — |
| 批量获取记录 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_get` | 20 次/秒 |
| 创建单条记录 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records` | 50 次/秒 |
| 批量创建记录 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_create` | 50 次/秒，单次最多 1,000 条 |
| 更新单条记录 | PUT | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id` | 50 次/秒 |
| 批量更新记录 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_update` | 50 次/秒，单次最多 1,000 条 |
| 删除单条记录 | DELETE | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id` | — |
| 批量删除记录 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_delete` | 50 次/秒，单次最多 1,000 条 |

**创建/更新记录请求体结构**：
```json
{
  "fields": {
    "字段名1": "值",
    "字段名2": 123
  }
}
```

**批量创建请求体**：`{ "records": [ { "fields": {...} }, ... ] }`，响应 `data.records[]`（每条含 `record_id`、`fields`）。
**批量更新请求体**：`{ "records": [ { "record_id": "...", "fields": {...} }, ... ] }`。
**批量删除请求体**：`{ "record_ids": ["recXXX", "recYYY"] }`，响应 `data.records[]`（每项 `{ "record_id": "...", "deleted": true }`）。

**查询记录（POST search）请求体**：
```json
{
  "view_id": "vewqhz51lk",
  "field_names": ["字段1", "字段2"],
  "sort": [ { "field_name": "字段1", "desc": true } ],
  "filter": { "conjunction": "and", "conditions": [...] },
  "automatic_fields": false
}
```
查询参数：`page_size`（默认 20，最大 500）、`page_token`、`user_id_type`（默认 `open_id`）。

**查询响应体**：
```json
{
  "code": 0,
  "data": {
    "has_more": false,
    "page_token": "...",
    "total": 123,
    "items": [
      {
        "record_id": "...",
        "created_time": 1691049973000,
        "created_by": { "id": "ou_...", "name": "...", ... },
        "last_modified_time": ...,
        "last_modified_by": {...},
        "fields": { "字段名": <value> }
      }
    ]
  }
}
```
注意：单条记录 GET 返回的是 `data.record`；批量/列表返回 `data.items`（旧版 list 返回 `data.records`）。

### 1.5 Field（字段）

| 操作 | HTTP 方法 | 完整 URL 路径 |
|---|---|---|
| 列出字段 | GET | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields` |
| 创建字段 | POST | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields` |
| 更新字段 | PUT | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields/:field_id` |
| 删除字段 | DELETE | `/open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields/:field_id` |

字段对象结构：
```json
{
  "field_id": "fldYWaldeW",
  "field_name": "文本",
  "type": 1,
  "description": "...",
  "is_primary": true,
  "property": null,
  "ui_type": "Text",
  "is_hidden": false
}
```

### 1.6 资源数量限制（官方）
- 字段：300（其中公式字段最多 100）
- 视图：200
- 数据表 + 仪表盘：100
- 高级权限自定义角色：30；协作者：200
- 批量操作单次最多 1,000 条记录，且整体全成功或全失败（无部分成功）
- 建议对单一多维表格同时只发起 1 次写操作（底层按版本串行，不支持并发写）

来源：https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview?lang=zh-CN

---

## 2. 精确限流配额

来源：
- 频控策略：https://open.feishu.cn/document/server-docs/api-call-guide/frequency-control?lang=zh-CN
- 各接口"接口频率限制"标注（如 batch_create 50/s、search 20/s、list tables 20/s）

### 2.1 按接口维度的 QPS（官方在每个接口页标注）

| 接口 | QPS | 来源 |
|---|---|---|
| 列出数据表 | 20 次/秒 | app-table/list |
| 列出记录 GET（旧版） | 20 次/秒 | app-table-record/list |
| 查询记录 POST search | 20 次/秒 | app-table-record/search |
| 批量获取 batch_get | 20 次/秒 | app-table-record/batch_get |
| 创建单条记录 | 50 次/秒 | app-table-record/create |
| 批量创建 batch_create | 50 次/秒 | app-table-record/batch_create（单次最多 1,000 条） |
| 更新记录 PUT | 50 次/秒 | app-table-record/update（rateLimitInfo: 50 次/秒） |
| 批量更新 batch_update | 50 次/秒 | |
| 批量删除 batch_delete | 50 次/秒 | app-table-record/batch_delete |

### 2.2 分页与批量上限
- 单页最大记录数（page_size 最大值）：**500**（默认 20）
- 批量操作单次最大记录数：**1,000** 条（batch_create / batch_update / batch_delete）
- filter 参数长度限制：≤ 2,000 字符
- sort 参数长度限制：≤ 1,000 字符

### 2.3 限流触发时的响应
超过阈值时返回 **HTTP 429 Too Many Requests**（部分旧版 OpenAPI 返回 HTTP 400）。响应体：
```json
{ "code": 99991400, "msg": "request trigger frequency limit" }
```
响应头（注意：不是标准 `Retry-After`，而是飞书自定义头）：
- `x-ogw-ratelimit-limit: 100`（窗口期上限，单位：秒）
- `x-ogw-ratelimit-reset: 52`（距离恢复还需等待的秒数）

处理策略：等待 `x-ogw-ratelimit-reset` 指定秒数后重试；持续 429 则继续退避。
多维表格业务层另有 `1254290 TooManyRequest`（请求过快，HTTP 200）与 `1254291 Write conflict`（同表并发写冲突，建议写接口间间隔 0.5~1 秒，或加查询参数 `ignore_consistency_check=true`）。

### 2.4 频控等级体系（全局）
频控按"每个 API × 每个应用 × 每个租户"维度计算。等级示例：等级 8 = 20 次/秒，等级 9/10 = 50 次/秒。多维表格、消息、群组不支持自助提频，需联系 CSM。

---

## 3. 完整错误码表

来源：
- 查询记录/列出记录页错误码表：https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search?lang=zh-CN
- 频控策略（99991400）
- 99991663 排查：https://open.larkoffice.com/document/faq/trouble-shooting/how-to-fix-99991663-error

### 3.1 通用（鉴权/权限/限流）错误码

| code | HTTP | 含义 | 处理策略 |
|---|---|---|---|
| 0 | 200 | 成功 | — |
| 99991400 | 429（旧版 400） | request trigger frequency limit 限流 | 读 `x-ogw-ratelimit-reset` 退避重试 |
| 99991661 | 400 | Missing token，请求头缺 Authorization | 补 `Authorization: Bearer <token>` |
| 99991663 | 400 | tenant token invalid，token 过期/无效/类型错误 | 重新获取 tenant_access_token；确认接口是否支持 tenant 身份 |
| 99991672 | 400 | 缺少权限 scope（permission_violations 指明所需 scope） | 到开发者后台开通对应 scope |

### 3.2 多维表格业务错误码（1254xxx 段，绝大多数 HTTP=200）

| code | HTTP | 含义 | 处理建议 |
|---|---|---|---|
| 1254000/1254001 | 200 | WrongRequestJson / WrongRequestBody 请求体错误 | 检查 JSON 与字段结构 |
| 1254002 | 200 | Fail 内部错误（场景多） | 减小单次数据量、避免并发、检查 page_token/table_id、偶发则重试 |
| 1254003 | 200 | WrongBaseToken app_token 错误 | 核对 app_token 来源 |
| 1254004 | 200 | WrongTableId table_id 错误 | 核对 table_id |
| 1254005 | 200 | WrongViewId view_id 错误 | 核对 view_id |
| 1254006 | 200 | WrongRecordId record_id 错误 | 核对 record_id |
| 1254009 | 200 | WrongFieldId field_id 错误 | 调用列出字段获取 |
| 1254011 | 400 | Page size must greater than 0 | page_size 非法（>0 且 ≤500） |
| 1254016 | 200 | InvalidSort | sort 参数错误 |
| 1254018 | 200 | InvalidFilter | filter 参数错误，参照筛选指南 |
| 1254024 | 200 | InvalidFieldNames | field_names 与表中字段名不完全匹配（注意空格/换行） |
| 1254030 | 200 | TooLargeResponse 响应体过大 | 缩小 page_size 或 field_names |
| 1254036 | 400 | Bitable is copying 复制中 | 等待复制完成 |
| 1254040 | 200 | BaseTokenNotFound app_token 不存在 | 检查 app_token |
| 1254041 | 200 | TableIdNotFound table_id 不存在 | 检查 table_id |
| 1254042 | 200 | ViewIdNotFound view_id 不存在 | 检查 view_id |
| 1254043 | 200 | RecordIdNotFound record_id 不存在 | 检查 record_id |
| 1254044 | 200 | FieldIdNotFound field_id 不存在 | 调用列出字段 |
| 1254045 | 200 | FieldNameNotFound 字段名不存在 | 核对字段名；检查高级权限 |
| 1254060~1254069 | 200 | 各字段类型转换失败（文本/数字/单选/多选/日期/复选框/人员/关联/超链接/附件） | 按字段类型校验写入值 |
| 1254072 | 200 | 电话字段转换失败 | 校验电话格式 |
| 1254100 | 200 | 数据表+仪表盘数量超限（≤100） | 删减表 |
| 1254101 | 200 | 视图数量超限（≤200） | 删减视图 |
| 1254103 | 200 | 记录数量超限（≤20,000，UI 可提升） | — |
| 1254104 | 200 | 单次添加/更新记录数量超限（≤1,000） | 分批 |
| 1254107 | 200 | Filter 长度超限（≤2,000 字符） | 精简 filter |
| 1254108 | 200 | Sort 长度超限（≤1,000 字符） | 精简 sort |
| 1254130 | 200 | TooLargeCell 单元格内容过大 | 单个单元格文本 ≤10 万字符 |
| 1254290 | 200 | TooManyRequest 请求过快 | 退避 |
| 1254291 | 200 | Write conflict 同表并发写冲突 | 串行写、间隔 0.5~1s、ignore_consistency_check |
| 1254301 | 200 | OperationTypeError 未开启高级权限 | — |
| 1254302 | 200 | Permission denied 无访问权限（高级权限） | 给应用/用户授予可管理权限或加群授权 |
| 1254303 | 200 | AttachPermNotAllow 附件无权限 | — |
| 1254607 | 400 | Data not ready 数据未就绪/计算超时 | 等一会重试、降低批量 page_size、避免并发写 |
| 1255040 | 504 | 请求超时 | 重试 |

---

## 4. 所有字段类型及其数据结构

来源：
- 数据结构概述（type/ui_type 枚举）：https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-structure?lang=zh-CN
- 记录数据结构（value 读写格式）：https://open.feishu.cn/document/docs/bitable-v1/app-table-record/bitable-record-data-structure-overview?lang=zh-CN
- 字段编辑指南（property 属性）：https://open.larkoffice.com/document/server-docs/docs/bitable-v1/app-table-field/guide

字段通过 `type`（int）+ `ui_type`（string）共同确定类型。

| 业务类型 | type | ui_type | 写入格式 | 读取格式 | 只读 | 额外属性 property |
|---|---|---|---|---|---|---|
| 文本 Text | 1 | Text | string | list of object `[{text, type:"text"}]` | 否 | null；单格 ≤10 万字符 |
| 条码 Barcode | 1 | Barcode | string | list `[{text,type:"text"}]` | 否 | `allowed_edit_modes:{scan,manual}` |
| 邮箱 Email | 1 | Email | string | list `[{text, link:"mailto:...", type:"url"}]` | 否 | null |
| 数字 Number | 2 | Number | number | number | 否 | `formatter`（"0"/"0.0"/"0.00"/"1,000"/"%" 等） |
| 进度 Progress | 2 | Progress | number | number | 否 | `formatter`、`range_customize`、`min`、`max` |
| 货币 Currency | 2 | Currency | number | number | 否 | `formatter`、`currency_code`（CNY/USD/EUR/...） |
| 评分 Rating | 2 | Rating | number | number | 否 | `formatter:"0"`、`min`(0/1)、`max`(1~10)、`rating.symbol` |
| 单选 SingleSelect | 3 | SingleSelect | string（选项名） | string | 否 | `options:[{name, color, id}]`；选项总数 ≤20,000 |
| 多选 MultiSelect | 4 | MultiSelect | array&lt;string&gt; | array&lt;string&gt; | 否 | `options`；单格选项 ≤1,000，选项总数 ≤20,000 |
| 日期 DateTime | 5 | DateTime | number（毫秒时间戳） | number（毫秒时间戳） | 否 | `date_formatter`、`auto_fill` |
| 复选框 Checkbox | 7 | Checkbox | boolean | boolean | 否 | null |
| 人员 User | 11 | User | list&lt;object&gt;（仅传 `id`） | list`[{id,name,en_name,avatar_url,email}]` | 否 | `multiple`（默认 true）；单格 ≤1,000 人 |
| 电话 Phone | 13 | Phone | string | string | 否 | null；长度 ≤64 |
| 超链接 Url | 15 | Url | object `{text, link}` | object `{text, link}` | 否 | null |
| 附件 Attachment | 17 | Attachment | 上传后传 file_token | list`[{file_token,name,type,size,url,tmp_url}]` | 否 | null；单格 ≤100 个 |
| 单向关联 SingleLink | 18 | SingleLink | object `{link_record_ids:[...]}` | 同左 | 否 | `multiple`、`table_id`；单格 ≤500 |
| 查找引用 Lookup | 19 | Lookup | 不可写 | object `{type, ui_type, value:list}` | **是** | null |
| 公式 Formula | 20 | Formula | 不可写 | object `{type, ui_type, value:list}` | **是** | `formatter`、`formula_expression` |
| 双向关联 DuplexLink | 21 | DuplexLink | object `{link_record_ids:[...]}` | 同左 | 否 | `multiple`、`table_id`、`back_field_name`；单格 ≤500 |
| 地理位置 Location | 22 | Location | object | object `{location,pname,cityname,adname,address,name,full_address}` | 否 | `location.input_type`（only_mobile/not_limit） |
| 群组 GroupChat | 23 | GroupChat | 不可直接写（按群 ID） | list`[{name,avatar_url,id}]` | 否 | `multiple`；单格 ≤10 个 |
| 流程 Stage | 24 | Stage | 不支持写接口 | — | **只读** | — |
| 创建时间 CreatedTime | 1001 | CreatedTime | 不可写 | number（毫秒时间戳） | **是** | `date_formatter` |
| 修改时间 ModifiedTime | 1002 | ModifiedTime | 不可写 | number（毫秒时间戳） | **是** | `date_formatter` |
| 创建人 CreatedUser | 1003 | CreatedUser | 不可写 | object `{id,name,...}` | **是** | null |
| 修改人 ModifiedUser | 1004 | ModifiedUser | 不可写 | object `{id,name,...}` | **是** | null |
| 自动编号 AutoNumber | 1005 | AutoNumber | 不可写 | string | **是** | `auto_serial`（type: custom / auto_increment_number） |
| 按钮 Button | 3001 | Button | 不支持写接口 | — | **只读** | — |

要点：
- 文本字段写入时直接传 string；读取时返回富文本对象数组。多行文本可用查询参数 `text_field_as_array=true` 以数组返回。
- 人员字段写接口只接受 `[{"id":"ou_xxx"}]`（id 类型由 `user_id_type` 决定，默认 open_id）；传空用 `null`。
- 附件写入需先通过素材上传接口拿到 `file_token`，再写 `[{"file_token":"..."}]`。
- 单选/多选更新字段时 options 为全量覆盖（未列出的选项会被删除）。
- 索引字段（is_primary=true）不可删除/移动/隐藏，且仅支持 type 1/2/5/13/15/20/22。

---

## 5. 筛选条件（filter）完整语法与操作符

来源：记录筛选参数填写说明 https://open.feishu.cn/document/docs/bitable-v1/app-table-record/record-filter-guide?lang=zh-CN

> 注意：旧版 GET list 接口的 filter 是公式字符串语法 `AND(CurrentValue.[身高]>180, ...)`；新版 POST search / batch_get 的 filter 为下方 JSON 结构。

### 5.1 JSON 结构
```json
{
  "filter": {
    "conjunction": "and",
    "conditions": [
      {
        "field_name": "职位",
        "operator": "is",
        "value": ["初级销售员"]
      }
    ],
    "children": [ ... ]   // 可选；仅支持一层 children 嵌套，不支持再次嵌套
  }
}
```
- `conjunction`：`"and"` 或 `"or"`。
- `conditions[]`：每个条件含 `field_name`、`operator`、`value`（string 数组）。
- 复杂且/或：顶层 conjunction + `children[]`（每个 child 又是 `{conjunction, conditions[]}`），仅一层嵌套。

### 5.2 操作符（operator）

| operator | 含义 | 适用/不适用 |
|---|---|---|
| `is` | 等于 | 通用；日期可用 |
| `isNot` | 不等于 | 不支持日期字段 |
| `contains` | 包含 | 不支持日期字段 |
| `doesNotContain` | 不包含 | 不支持日期字段 |
| `isEmpty` | 为空 | 通用；value 须传 `[]` |
| `isNotEmpty` | 不为空 | 通用；value 须传 `[]` |
| `isGreater` | 大于 | 通用（数字/日期） |
| `isGreaterEqual` | 大于等于 | 不支持日期字段 |
| `isLess` | 小于 | 通用（数字/日期） |
| `isLessEqual` | 小于等于 | 不支持日期字段 |
| `like` | LIKE | **暂未支持** |
| `in` | IN | **暂未支持**（多选/单选/关联可用多元素 value 实现"或"） |

### 5.3 value 填写规则（按字段类型）
- 多行文本/条码/数字/货币/进度/评分/电话/超链接/地理位置/自动编号：列表仅 1 或 0 个元素；数字以字符串形式传（如 `"23.4"`）。
- 单选/多选/关联/人员/群组/创建人/修改人：`is`/`isNot` 传 1 个元素；其他 operator 可传多个；`isEmpty`/`isNotEmpty` 传 `[]`。
- 复选框：仅支持 `is`，value 为 `["true"]` 或 `["false"]`。
- 附件：仅支持 `isEmpty`/`isNotEmpty`，value 传 `[]`。
- 日期/创建时间/修改时间：operator 仅支持 `is`、`isEmpty`、`isNotEmpty`、`isGreater`、`isLess`。value 为特殊数组：
  - `["ExactDate","1702449755000"]`（具体日期，第二个元素为毫秒时间戳，按文档时区当天零点过滤）
  - `["Today"]`、`["Tomorrow"]`、`["Yesterday"]`
  - `["CurrentWeek"]`、`["LastWeek"]`、`["CurrentMonth"]`、`["LastMonth"]`（仅 `is`）
  - `["TheLastWeek"]`、`["TheNextWeek"]`、`["TheLastMonth"]`、`["TheNextMonth"]`（仅 `is`）

限制：filter 总长 ≤2,000 字符；不支持对公式/查找引用字段筛选；不支持按人员/关联字段的属性（如 openID）筛选。

---

## 6. 排序（sort）语法

来源：查询记录接口 https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search?lang=zh-CN

```json
{
  "sort": [
    { "field_name": "字段1", "desc": true },
    { "field_name": "字段2", "desc": false }
  ]
}
```
- `sort` 为数组，**支持多字段排序**，按数组顺序逐层排序。
- 每项：`field_name`（字段名）+ `desc`（boolean，true=降序，false=升序）。
- 长度限制：sort 数组长度 0~100；sort 参数整体字符 ≤1,000。
- 不支持对带公式和关联字段的表排序（旧版 list 说明）。
- 当 filter 或 sort 非空时，指定的 `view_id` 会被忽略（视为对全表数据过滤）。

旧版 GET list 的 sort 为字符串数组形式：`["字段1 DESC","字段2 ASC"]`。

---

## 7. Webhook 事件类型及验签机制

来源：
- 多维表格记录变更事件：https://open.feishu.cn/document/docs/bitable-v1/events/bitable_record_changed?lang=zh-CN
- 接收回调/验签：https://open.larkoffice.com/document/event-subscription-guide/callback-subscription/receive-and-handle-callbacks

### 7.1 事件类型
- 事件类型：**`drive.file.bitable_record_changed_v1`**（多维表格记录变更）。被订阅的多维表格记录发生新增/修改/删除时触发。
- 注意：公式字段值变化不触发事件；事件体不含公式字段值。字段变更还会同时触发"文件编辑"事件。
- 订阅前提：需先调用"订阅云文档事件"接口把目标多维表格加入订阅。
- 权限要求：需同时为应用身份和用户身份开通 `bitable:app` 或 `drive:drive`。
- 另有"多维表格字段变更"等相关事件（同目录 events 下）。

### 7.2 事件回调数据结构（schema 2.0）
```json
{
  "schema": "2.0",
  "header": {
    "event_id": "5e3702a84e847582be8db7fb73283c02",
    "event_type": "drive.file.bitable_record_changed_v1",
    "create_time": "1608725989000",
    "token": "rvaYgkND1GOiu5MM0E1rncYC6PLtF7JV",
    "app_id": "cli_9f5343c580712544",
    "tenant_key": "2ca1d211f64f6438"
  },
  "event": {
    "file_type": "bitable",
    "file_token": "bascnItn6oHUSEL8RDUdF6abcef",
    "table_id": "tblOaqBWfGeabcef",
    "revision": 41,
    "operator_id": { "union_id": "on_...", "user_id": "...", "open_id": "ou_..." }
  }
}
```

### 7.3 订阅配置方式
- Webhook 模式：在开发者后台配置公网回调地址（HTTP POST），首次配置时飞书会推送 challenge，需在 1 秒内原样返回 `{"challenge":"..."}`。
- 也支持长连接（WebSocket）模式接收事件。
- 须在 3 秒内响应回调，否则判为推送失败。

### 7.4 验签机制
配置 Encrypt Key 后使用签名校验。请求头：
- `X-Lark-Request-Timestamp`（时间戳）
- `X-Lark-Request-Nonce`（随机串）
- `X-Lark-Signature`（待比对签名）

算法（SHA-256）：
```
signature = sha256( timestamp + nonce + encrypt_key + raw_body )
```
- `raw_body` 为原始请求体（不要反序列化后再算）。
- 比对计算结果与 `X-Lark-Signature` 是否一致（hex 编码）。
Python 示例：
```python
s = hashlib.sha256((timestamp + nonce + encrypt_key).encode('utf-8') + body).hexdigest()
```
若配置了加密策略，回调体为加密数据，需先 **AES-256-CBC** 解密：key = sha256(encrypt_key)，前 16 字节为 IV，其余为密文，base64 解码后解密并去 PKCS 填充。
另一种较弱的方式是校验请求体中的 `Verification Token` 是否与后台配置一致。

---

## 8. Token 机制

来源：
- 自建应用获取 tenant_access_token：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal?lang=zh-CN
- 频控/鉴权相关页

### 8.1 tenant_access_token（应用身份）
- 端点：`POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`（v3 为历史版本，最新版路径为 v2，能力一致；仅自建应用）
- 请求体：
```json
{ "app_id": "cli_slkdjalasdkjasd", "app_secret": "dskLLdkasdjlasdKK" }
```
- 响应体：
```json
{ "code": 0, "msg": "ok", "tenant_access_token": "t-caecc...", "expire": 7200 }
```
- 有效期：最大 **2 小时（7200 秒）**。剩余有效期 ≥30 分钟时重复获取返回原 token；<30 分钟时返回新 token（新旧可短暂并存）。建议服务端定时刷新。

### 8.2 user_access_token（用户身份）
- 用于以登录用户身份调用，数据范围由用户权限决定。走 OAuth 授权码流程获取；新版端点为 `https://accounts.feishu.cn/oauth/v3/token`（国际版对应 accounts.larksuite.com）。
- 适用场景：代表某个具体用户操作其有权访问的多维表格；tenant token 无权访问的资源。

### 8.3 请求中传递方式
- 请求头：`Authorization: Bearer {access_token}`
  - tenant 示例：`Bearer t-g1044qeGEDXTB6NDJOGV4JQCYDGHRBARFTGT1234`
  - user 示例：`Bearer u-cjz1eKCEx289x1TXEiQJqAh5171B4gDHPq00l0GE1234`
- 另需 `Content-Type: application/json; charset=utf-8`。

### 8.4 token 过期/无效响应
- 缺 token：`99991661`（HTTP 400）
- token 无效/过期/类型错误：`99991663 tenant token invalid`（HTTP 400）。处理：重新获取 token；确认接口是否支持所用 token 类型。
- 注意：用 tenant_access_token 调用仅支持 user_access_token 的接口也会报 99991663。

---

## 9. 国内版 vs 国际版域名差异

来源：SDK 调用文档（BaseUrlEnum）、FAQ。

| 用途 | 飞书国内版 | Lark 国际版 |
|---|---|---|
| OpenAPI 网关域名 | `https://open.feishu.cn` | `https://open.larksuite.com` |
| 文档站 | open.feishu.cn | open.larkoffice.com / open.larksuite.com |
| 用户 OAuth token 端点 | `https://accounts.feishu.cn/oauth/v3/token` | `https://accounts.larksuite.com/oauth/v3/token` |

- 所有业务路径（如 `/open-apis/bitable/v1/...`、`/open-apis/auth/v3/...`）在两版完全一致，仅替换域名前缀。
- SDK 中通过 domain 参数切换：`Domain.Feishu`（默认 open.feishu.cn）/ `Domain.Lark`（open.larksuite.com）。
- 常见坑：海外调试台默认 open.larksuite.com，而 SDK 默认 open.feishu.cn，域名不匹配会报错，需显式设置。

---

## 10. 权限范围（scope）清单

来源：各接口"权限要求"与错误码 99991672 排查文档。

| scope 名称 | 中文含义 | 权限范围 |
|---|---|---|
| `bitable:app` | 查看、评论、编辑和管理多维表格 | 多维表格读写（记录/字段/表/视图等全套写操作所需） |
| `bitable:app:readonly` | 查看、评论、导出多维表格 | 只读（列出表/记录/字段、获取元数据） |
| `base:record:retrieve` | 检索特定记录 | 读取单条/批量获取记录 |
| `base:record:create` | 新增记录 | 创建记录 |
| `base:record:update` | 更新记录 | 更新记录 |
| `base:record:delete` | 删除记录 | 删除记录 |
| `base:app:create`（类） | 创建多维表格 | 创建 app |
| `drive:drive` | 查看、评论、编辑和管理云空间中所有文件 | 订阅记录变更事件时所需（与 bitable:app 二选一即可） |

说明：
- 多数读接口"开启任一权限即可"：`bitable:app` 或 `bitable:app:readonly`。
- 写接口通常要求 `bitable:app`（编辑管理）。
- 细粒度 `base:record:*` scope 用于按记录级别授权；报错 99991672 时返回体的 `error.permission_violations` 会明确列出所需 scope。
- 字段级敏感权限：返回人员字段需额外开通"获取用户基本信息""获取用户 user ID"等通讯录 scope。
- 除 scope 外，还必须把应用加为多维表格协作者（添加文档应用）或由应用自建该多维表格，否则即使 scope 齐全也会 403/无权限（1254302）。

---

## 附：关键官方文档 URL 汇总
- 多维表格概述/端点列表：https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview?lang=zh-CN
- 数据结构概述：https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-structure?lang=zh-CN
- 记录数据结构：https://open.feishu.cn/document/docs/bitable-v1/app-table-record/bitable-record-data-structure-overview?lang=zh-CN
- 字段编辑指南：https://open.larkoffice.com/document/server-docs/docs/bitable-v1/app-table-field/guide
- 查询记录（search）：https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search?lang=zh-CN
- 筛选参数指南：https://open.feishu.cn/document/docs/bitable-v1/app-table-record/record-filter-guide?lang=zh-CN
- 频控策略：https://open.feishu.cn/document/server-docs/api-call-guide/frequency-control?lang=zh-CN
- tenant_access_token：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal?lang=zh-CN
- 记录变更事件：https://open.feishu.cn/document/docs/bitable-v1/events/bitable_record_changed?lang=zh-CN
- 回调验签：https://open.larkoffice.com/document/event-subscription-guide/callback-subscription/receive-and-handle-callbacks

> 标注：sort 数组元素字段名 `field_name`/`desc` 依据查询记录接口请求体及官方示例归纳；旧版 GET list 的字符串 sort 语法已明确记载。若个别 QPS（如删除单条记录、字段/视图/表的写接口具体数字）未在对应接口页逐项列出，本文以已官方标注者为准，未标注项不臆造。
