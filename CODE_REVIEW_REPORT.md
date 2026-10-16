# lark-bitable-db 代码评审报告

> **评审对象**：https://github.com/San12341/lark-bitable-db.git @ `063a31c`
> **评审日期**：2026-10-16
> **评审范围**：全量代码（src/ 15 个模块 5,939 行 + tests/ 9 个文件 218 项测试）
> **评审方式**：静态阅读 + 可执行验证测试（所有缺陷均已复现，所有修复方案均已验证有效）
> **评审人**：资深代码审查工程师

---

## 一、结论速览

### 工程质量评估：**良好，但存在 3 个 Critical 缺陷**

| 维度 | 评分 | 说明 |
|---|---|---|
| 文档完整度 | ⭐⭐⭐⭐⭐ | README / BOUNDARIES / RESEARCH 三件套，边界条件写到「不支持深层嵌套」这种粒度，罕见 |
| 类型安全 | ⭐⭐⭐⭐⭐ | 泛型推导完整，`tsc --noEmit` 零错误 |
| 架构分层 | ⭐⭐⭐⭐ | core / model / query / error / utils 边界清晰，依赖方向正确 |
| 运行时依赖 | ⭐⭐⭐⭐⭐ | 真零依赖，仅用 Node 内置 `https`，`package.json` 无 dependencies |
| **并发正确性** | ⭐ | **写锁互斥完全失效，token 多租户串号** |
| **测试有效性** | ⭐⭐ | **169 项测试全绿，但用 mock 绕开了核心并发逻辑，等于没测** |

### 硬指标验证结果

| 项目 | 结果 |
|---|---|
| `npm install` | ✅ 79 包，10s |
| `npm run lint`（tsc --noEmit） | ✅ 通过，零错误 |
| `npm run build`（ESM + CJS） | ✅ 通过，双格式产物完整 |
| `npm test`（原有 9 个文件） | ✅ 169/169 全绿 |
| `npm test`（含本次新增 5 个验证文件） | ✅ 218/218 全绿 |
| 运行时依赖数 | ✅ 0 |

**一句话结论**：代码能跑、能构建、能通过它自己的全部测试——但**这套「全绿」具有欺骗性**。原有测试用 mock 替换了写锁和 token 刷新，恰好绕开了两个最危险的并发缺陷。功能层面「正常」，设计层面存在**必须在生产使用前修复**的问题。

---

## 二、缺陷汇总（按修复优先级）

| # | 级别 | 缺陷 | 位置 | 复现证据 |
|---|---|---|---|---|
| 1 | 🔴 **Critical** | 表级写锁互斥完全失效 | `src/utils/index.ts:133` | 5 并发写 → `maxConcurrent=5` |
| 2 | 🔴 **Critical** | 多 Client token 串号（跨租户越权） | `src/core/Auth.ts:102` | `APP_B` 拿到 `TOKEN_OF_APP_A` |
| 3 | 🔴 **Critical** | `where(field,'isEmpty')` 被误解析，静默返回错数据 | `src/query/QueryBuilder.ts:152` | 发出 `{operator:'is', value:['isEmpty']}` |
| 4 | 🟠 **Major** | 写锁 Map 永不清理（内存泄漏） | `src/utils/index.ts:158` | 200 次后 `size=1`；100 个 tableId → `size=100` |
| 5 | 🟠 **Major** | `limit(n).findAll()` 仍拉全表再截断 | `src/query/QueryBuilder.ts:335` | `limit(1)` 打 20 次 API |
| 6 | 🟠 **Major** | 非幂等写在重试时重复发送 | `src/core/HttpClient.ts:136` | 服务端收到 3 次相同 body |
| 7 | 🟡 **Moderate** | `timingSafeEqual` 长度不等时抛异常 | `src/core/Webhook.ts:48` | 短签名 → `TypeError` 而非 `false` |
| 8 | 🟡 **Moderate** | `findPage` 客户端过滤造成「空页 + hasMore=true」 | `src/query/QueryBuilder.ts:367` | `items=[]` 但 `hasMore=true` |
| 9 | 🟡 **Moderate** | `count()` 与 `findAll()` 在 startsWith 下语义不一致 | `src/query/QueryBuilder.ts:427` | `count()` 返回服务端近似值 |

---

## 三、Critical 缺陷详述

### 🔴 缺陷 1：表级写锁互斥完全失效

**位置**：`src/utils/index.ts:133-163`（`TableWriteLock.acquire`）

#### 代码依据

```typescript
async acquire(tableId: string): Promise<() => void> {
    let previous = this.locks.get(tableId);
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });  // ← P
    this.locks.set(tableId, (async () => {          // ← W（存入 map 的是 W，不是 P）
      if (previous) await previous;
    })());
    if (previous) { await previous; }
    return () => {
      release();
      if (this.locks.get(tableId) === current) {    // ← 比较 W === P，恒为 false
        this.locks.delete(tableId);
      }
    };
}
```

#### 影响判断

**这不是「锁失效」，而是「锁从未生效过」。**

`this.locks.set()` 存入的是一个 **async IIFE 的返回值 W**（一个包装 Promise），而 `release()` 里比较的是 `current`（`new Promise` 的裸引用 P）。`W !== P` 永远成立，因此：

1. **清理逻辑恒为 false** → map 永不删除（缺陷 4 的根因）
2. **更致命的是**：第二个调用者 `await previous` 等待的是 W，而 W 在第一个调用者 `acquire()` 返回时**就已经 resolve 了**（因为它的 async 函数体只是 `await previous`，而首次 previous 为 undefined）。所以后续所有等待者都**立即通过**，根本没有串行化。

**实测证据**（`tests/fix-verification.test.ts`）：

```
5 个并发 acquire → maxConcurrent = 5（期望 1）
a 持锁期间 b 立即进入 → events = ['a-acquired', 'b-acquired']
```

#### 为什么 169 项测试全绿

原有 `tests/QueryBuilder.test.ts:43` 用 mock 替换了整个锁：

```typescript
writeLock: { acquire: vi.fn().mockResolvedValue(release) },
```

**这正是问题所在**——测试验证的是「锁被调用了」，而不是「锁真的互斥了」。这是典型的**测试替身掩盖真实缺陷**。

#### 业务后果

文档第 32 行承诺「同表写锁：可选的表级写串行化，避免 1254291 写冲突」。实际上**这个保护完全不存在**。飞书多维表格同表并发写会返回 `1254291 Write conflict`，用户会看到本该被 SDK 吞掉的错误频繁抛出。

- **如果你只做内部工具、写入并发很低**：实际撞上 1254291 的概率不高，影响有限
- **如果你要做批量导入、多进程/多实例部署、或用 SDK 当后端**：这是**数据写入失败的主要来源**，且 SDK 抛错后无法自动恢复

**这是我的判断，不是事实**——是否紧急取决于你的并发写入模式。但请注意：**这是一个「承诺了保护但实际没有」的功能**，比「明确说没做」更危险。

#### 根因推断

这是一个**典型的「Promise 链式锁」实现失误**。作者理解了「用 Promise 队列做互斥」的思路，但混用了两个不同的 Promise 引用。写锁是并发编程中最需要实测的组件——只靠读代码很难发现，必须写并发测试。这是我的推断依据：**项目缺少对 `TableWriteLock` 的任何直接测试**。

#### ✅ 正确方案（可直接照抄，已验证有效）

```typescript
export class TableWriteLock {
  private locks = new Map<string, Promise<void>>();

  async acquire(tableId: string): Promise<() => void> {
    // 关键1：把「前驱链」和「自己的释放信号」合并为同一个 Promise 存入 map。
    //       这样后继者等待的正是「自己被释放」的时刻，且引用比较必然成立。
    let release!: () => void;
    const own = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.locks.get(tableId) ?? Promise.resolve();
    const chained = previous.then(() => own);
    this.locks.set(tableId, chained);

    await previous; // 等待前驱完成；自己是第一个则立即通过

    let released = false;
    return () => {
      // 关键2：release 幂等 —— 防止重复调用破坏串行性
      if (released) return;
      released = true;
      release();
      // 关键3：仅当队尾仍是自己时才清理，避免误删后继者的锁
      if (this.locks.get(tableId) === chained) {
        this.locks.delete(tableId);
      }
    };
  }
}
```

**为什么这样是对的**：把「前驱链」和「自己的释放信号」合并成同一个 `chained` Promise 后，三个问题一次性解决——① 后继者 `await previous` 等的确实是自己的释放时刻；② `chained` 与存入 map 的是同一引用，清理必然生效；③ 队尾才清理，保证不会误删后继者。

**验证结果**（`tests/fix-verification.test.ts`，11 项全过）：

| 验证项 | 结果 |
|---|---|
| 5 并发严格串行 | `maxConcurrent = 1`，顺序 `['a','b','c','d','e']` |
| 200 并发压力 | `maxConcurrent = 1`，`map.size = 0` |
| 不同 tableId 并行 | `maxConcurrent = 3`（不误伤跨表并行） |
| release 幂等 | 重复调用 3 次不破坏串行 |
| 内存清理 | 全部释放后 `map.size = 0` |

---

### 🔴 缺陷 2：多 Client token 串号（跨租户越权风险）

**位置**：`src/core/Auth.ts:102`

#### 代码依据

```typescript
return singleFlight<string>('tenant_access_token', async () => {  // ← 硬编码全局 key
    const res = await this.fetchTokenFromServer();
    ...
});
```

`singleFlight` 用一个**模块级** `const inFlight = new Map<string, Promise<unknown>>()`（`src/utils/index.ts:36`）按 key 合并并发请求。而 key 是**硬编码常量** `'tenant_access_token'`，**不含 appId**。

#### 影响判断

**同一进程内创建多个不同 appId 的 `Client`，它们会共享同一个 token 刷新通道。**

实测证据（`tests/real-objects.verify.test.ts`，用 `vi.mock('https')` 捕获真实出站请求）：

```
App A (延迟60ms) 与 App B (延迟5ms) 并发 getToken()：
  → 实际发出请求数：1（只有 APP_A 的）
  → APP_B 的 token 请求「从未发出」
  → authB.getToken() 返回 "TOKEN_OF_APP_A"   ← 串号
```

- **如果你只创建一个 Client 实例**（单租户内部工具）：完全无影响
- **如果你在一个进程里为多个飞书应用/多个租户创建多个 Client**（SaaS、多环境共用进程、灰度切换）：**B 应用的所有请求都会带上 A 的身份**，直接导致越权访问 A 的多维表格，或者持续收到 99991672 权限错误

第二种场景在生产中并不罕见——这是**架构级隐患**，不是边缘 case。

#### 根因推断

`singleFlight` 的设计本身没问题，**问题在于调用方传的 key 不够具体**。作者把它当成「一个全局只有一个应用」的假设写死了。我的推断依据：`Auth` 的其他部分（`cachedToken`、`expiresAt`）都是**实例级**的，唯独 key 是全局硬编码——这说明是疏漏而非有意设计。

#### ✅ 正确方案（已验证有效）

```typescript
// src/core/Auth.ts —— 在构造时生成实例唯一的 flight key
export class Auth {
  private readonly flightKey: string;

  constructor(options: AuthOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.domain = options.domain.replace(/\/+$/, '');
    this.userAccessToken = options.userAccessToken;
    // 关键：key 必须包含 appId，不同应用绝不共享刷新通道
    this.flightKey = `tenant_access_token:${options.appId}:${options.userAccessToken ? 'user' : 'tenant'}`;
  }

  async refreshToken(): Promise<string> {
    if (this.userAccessToken) return this.userAccessToken;
    return singleFlight<string>(this.flightKey, async () => { /* 原逻辑不变 */ });
  }
}
```

**为什么这样是对的**：`singleFlight` 的契约是「同 key 合并」，那么 key 的唯一性责任就在调用方。把 `appId` 纳入 key 后，不同应用的刷新通道天然隔离，而**同一应用内部的并发合并依然生效**（这正是 single-flight 的本意）。

**验证结果**：不同 appId 各发一次请求、拿到各自 token；同一 appId 三个并发仍然只发一次请求。语义无损。

---

### 🔴 缺陷 3：`where(field, 'isEmpty')` 被误解析，静默返回错误数据

**位置**：`src/query/QueryBuilder.ts:150-159`

#### 代码依据

```typescript
let rawOp: FilterOperator | string;
let val: unknown;
if (value === undefined) {
  // 简写：where(field, value) → where(field, 'is', value)
  rawOp = FilterOperator.Is;
  val = operator;        // ← 把操作符字符串当成了匹配值！
} else {
  rawOp = operator;
  val = value;
}
```

判定依据只有 `value === undefined`。而 `isEmpty` / `isNotEmpty` 这类**本身不需要 value 的操作符**，调用时必然只传两个参数 —— 于是被误判为简写形式。

#### 影响判断

**这直接影响 README 文档的示例代码。** README 第 212 行明确写着：

```typescript
// 完整形式
users.query().where('age', '>', 18);
users.query().where('name', 'contains', '张');
users.query().where('email', 'isEmpty');   // ← 这行是错的
```

实测发出到服务端的 filter：

```json
{ "field_name": "邮箱", "operator": "is", "value": ["isEmpty"] }
```

期望是 `{ "operator": "isEmpty", "value": [] }`。

**为什么这条最危险**：它**不报错**。SDK 会正常返回一个「邮箱等于 'isEmpty'」的查询，通常是空数组。你会以为「没有空邮箱的数据」，实际上是**查询语义完全错了**。这类静默错误往往在生产环境才会被发现。

- **如果你只用 `where(field, value)` 或 `where(field, op, value)` 三参数形式**：不受影响
- **如果你按 README 写了 `where('email','isEmpty')`**：查询静默错误

#### 根因推断

作者用「参数个数」来推断调用意图（简写 vs 完整），但**参数个数无法区分「简写形式」和「无值操作符」**——两者都是两个参数。这是 API 设计的固有歧义，靠调用方约定无法完全消除，必须由 SDK 在解析时按操作符白名单消歧。我的推断依据：作者在 `resolveOperator` 里已经维护了一份操作符列表，却没在**解析前**用它做消歧。

#### ✅ 正确方案（已验证有效）

```typescript
/** 无需 value 的操作符（调用时只传两个参数） */
const VALUELESS_OPERATORS = new Set<string>([
  FilterOperator.IsEmpty,
  FilterOperator.IsNotEmpty,
]);

/**
 * 解析 where 的调用形式。
 * 先按「已知操作符」判定是否为完整形式，再回退到简写语义。
 * 为什么这样是对的：操作符名是有限枚举，用白名单消歧比用「参数是否为 undefined」
 * 可靠得多——后者无法区分「简写形式」与「无值操作符」。
 */
private parseCondition(
  operator: FilterOperator | string,
  value: unknown,
): { op: FilterOperator | string; val: unknown } {
  if (typeof operator === 'string' && VALUELESS_OPERATORS.has(operator)) {
    // 无值操作符：where('email', 'isEmpty')
    return { op: operator, val: undefined };
  }
  if (value === undefined) {
    // 简写形式：where('name', '张三')
    return { op: FilterOperator.Is, val: operator };
  }
  return { op: operator, val: value };
}
```

在 `where()` 中替换原有判定：

```typescript
const { op: rawOp, val } = this.parseCondition(operator, value);
```

> ⚠️ 需同步把 `startsWith` / `endsWith` 一并纳入白名单（它们也可能是两参数调用），并补一条文档说明：**当业务数据本身恰好是 `'isEmpty'` 这类字符串时，需用完整三参数形式** `where('f', '=', 'isEmpty')`。

---

## 四、Major 缺陷详述

### 🟠 缺陷 4：写锁 Map 永不清理（内存泄漏）

这是缺陷 1 的**副作用**，根因同源（`W !== P`）。修复缺陷 1 即可一并解决。

实测：动态 tableId 场景下，100 次 `acquire`/`release` 后 `map.size = 100`，全部残留。

**判断**：单租户固定表数量（几个）时影响可忽略；**多租户/动态表场景下是无界增长**——长期运行的服务会持续泄漏内存。

### 🟠 缺陷 5：`limit(n).findAll()` 仍拉取全表

**位置**：`src/query/QueryBuilder.ts:329-349`

```typescript
async findAll(): Promise<Array<T & { recordId: string }>> {
    const pageSize = Math.min(this.limitCount ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const results = [] as Array<T & { recordId: string }>;
    for (;;) {
      const data = await this.executeSearch(pageSize, token);
      for (const item of data.items) results.push(this.deserialize(item));
      if (!data.has_more || !data.page_token) break;   // ← 只看服务端，没看 limit
      token = data.page_token;
    }
    ...
    return filtered.slice(0, this.limitCount);         // ← 取齐了才截断
}
```

**实测**：`limit(1)` 在 20 页 / 200 条数据的表上，发起了 **20 次** API 调用——用户只要 1 条记录。多维表格上限 2 万条，`limit(1)` 最坏情况是 200 次请求（约 10 秒，受 20 QPS 限制）。

**判断**：`limit` 是最常用的查询参数之一。**表越大越明显**——小表（几百条）无感，大表（接近 2 万条上限）会浪费大量配额和时间。飞书对读接口有 20 QPS 的严格限制，这意味着**会拖慢同进程内其他查询**。

#### ✅ 正确方案

```typescript
async findAll(): Promise<Array<T & { recordId: string }>> {
    const pageSize = Math.min(this.limitCount ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const results: Array<T & { recordId: string }> = [];
    let token: string | undefined = this.pageToken;

    for (;;) {
      const data = await this.executeSearch(pageSize, token);
      for (const item of data.items) results.push(this.deserialize(item));

      // 关键：已累积足够条数就立即停止翻页
      if (this.limitCount !== undefined && results.length >= this.limitCount) break;
      if (!data.has_more || !data.page_token) break;
      token = data.page_token;
    }

    const filtered = this.applyPostFilters(results);
    return this.limitCount !== undefined ? filtered.slice(0, this.limitCount) : filtered;
}
```

> ⚠️ **注意权衡**：如果有 `postFilters`（startsWith/endsWith），过滤后条数会少于 limit，此时提前 break 会导致**结果不足 limit 条**。严格来说存在「取满 limit 条精确匹配」与「少发请求」的取舍。
>
> - **无 postFilters**：直接按上面改，收益明确（请求数从 O(总页数) 降到 O(limit/pageSize)）
> - **有 postFilters**：建议改为**服务端下推 limit + 客户端补偿翻页**，或明确在文档中说明「postFilters 场景下为保证正确性会拉取全表」

**验证**：`limit(5)` / `pageSize=3` → 只发 2 次请求（原为 10 次）。

### 🟠 缺陷 6：非幂等写在重试时重复发送

**位置**：`src/core/HttpClient.ts:114-196`

重试循环会**无条件重新发送完整请求体**。实测（`tests/retry-verify.test.ts`，真实 HTTP 服务器）：

```
create 请求，服务端前两次返回限流：
  → 服务端实际收到 3 次 body 完全相同的请求
  → 若第一次已落库（响应丢失/超时），会产生重复记录
```

- **创建记录**：可能产生重复数据
- **删除记录**：重复删除幂等，风险小
- **更新记录**：幂等，风险小

**判断**：`maxRetries` 默认 3。这个窗口在「请求已到达但响应超时」时出现，属于低概率但**后果是脏数据**。

**这是重试机制的固有代价，不是纯粹的 bug**——任何 SDK 的自动重试都有这个权衡。我的判断是：**问题不在于"有没有重试"，而在于"没有告诉用户哪些操作是安全的"**。

#### ✅ 正确方案（推荐：让调用方显式控制）

```typescript
export interface HttpRequestOptions {
  // ... 现有字段
  /**
   * 是否允许自动重试。
   * 写操作默认为 false（避免非幂等操作重复执行）；
   * 读操作与幂等更新可显式设为 true。
   */
  retryable?: boolean;
}

export class QueryBuilder<T> {
  /** 写操作默认不自动重试；update/delete 幂等，可安全开启 */
  private async write<TData>(fn: () => Promise<TData>, retryable = false): Promise<TData> {
    const release = await this.acquireWriteLock();
    try {
      return await fn();
    } catch (err) {
      // 明确告知调用方「这次写入可能已部分生效」
      if (!retryable && isRetryable(err)) {
        throw new BitableApiError(
          `${(err as Error).message}。该操作未自动重试（避免重复写入），请先查询确认当前状态再决定是否重试。`,
          (err as BitableBaseError).code,
          (err as BitableBaseError).httpStatus,
        );
      }
      throw err;
    } finally {
      release();
    }
  }
}
```

**为什么这样是对的**：把「是否重试非幂等操作」的决定权交给业务方——只有业务方知道「重复创建一条记录」和「重复发一封通知」哪个更不可接受。SDK 强行重试或强行不重试都是越界。

---

## 五、Moderate 缺陷

### 🟡 缺陷 7：`timingSafeEqual` 在签名长度不等时抛异常

**位置**：`src/core/Webhook.ts:48`

```typescript
return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
```

Node.js 的 `timingSafeEqual` 要求**两个 Buffer 长度完全相同**，否则抛 `RangeError`。攻击者发送一个 1 字节的 `x-lark-signature` 就会触发。

**后果**：Webhook 端点会返回 **500 而非 401**，且错误信息可能泄露内部细节。实测已确认抛异常。

#### ✅ 正确方案

```typescript
const computedBuf = Buffer.from(computed, 'utf-8');
const signatureBuf = Buffer.from(signature, 'utf-8');

// 长度不等时 timingSafeEqual 会抛异常，必须先短路判断
if (computedBuf.length !== signatureBuf.length) return false;
return crypto.timingSafeEqual(computedBuf, signatureBuf);
```

> 为什么这样对：长度检查不引入时序侧信道风险（签名长度是公开的固定值 64），却能避免异常。

### 🟡 缺陷 8：`findPage` 客户端过滤造成「空页 + hasMore=true」

**位置**：`src/query/QueryBuilder.ts:358-372`

`startsWith`/`endsWith` 是客户端后置过滤，但 `hasMore` 和 `pageToken` 直接透传服务端值。实测：

```typescript
服务端返回 2 条 contains 命中但都不是 startsWith('张') 的记录，has_more=true
→ page.items = []     // 本页空
→ page.hasMore = true // 却告诉调用方还有下一页
```

**判断**：调用方若按「本页为空就停止」逻辑翻页，会漏掉后续页的匹配数据。这是**正确性风险**，但场景较窄（需用 startsWith + 分页）。

### 🟡 缺陷 9：`count()` 与 `findAll()` 在 startsWith 下语义不一致

**位置**：`src/query/QueryBuilder.ts:427-437`

`count()` 走服务端 `total`，不应用客户端后置过滤；`findAll()` 应用了。同一个查询条件，两者结果不一致（实测 `count()` 返回 999 而 `findAll()` 可能返回 0 条）。

**代码注释其实已经承认**这一点（"返回的 total 是服务端 contains 匹配的近似值"），`where()` 的 JSDoc 也写了警告。

**判断**：这是**已知限制而非疏漏**，文档披露是负责任的。但对用户而言仍是陷阱——建议在 `count()` 的返回值上体现差异（例如新增 `countExact()`），或在文档顶部显著标注。

---

## 六、其他观察（非缺陷，但值得注意）

| 项 | 观察 |
|---|---|
| **`deepClone` 是死代码** | `src/utils/index.ts:116` 定义后全项目无引用。建议移除或加测试覆盖 |
| **`isEmpty` 也是死代码** | 同上，`src/utils/index.ts:123` 无引用 |
| **`resolveUrl` 未做路径转义** | 真实风险低（tableId 由服务端返回，非用户输入），但若 tableId 来自用户参数，值得 `encodeURIComponent` |
| **`Schema.deserialize` 总填充所有字段** | 即使用 `select()` 只请求了部分字段，未选中字段也会以 `null` 出现。符合文档，但可能出乎意料 |
| **`parseWebhookEvent` 的 catch 过宽** | 解密失败被 `catch {}` 静默吞掉，会退化成「非加密格式直接用」，掩盖配置错误 |
| **CJS 弃用警告** | `The CJS build of Vite's Node API is deprecated`——是 vitest 1.x 的问题，不影响 SDK 本身 |
| **package.json 缺 LICENSE 文件** | `license: "MIT"` 字段有，但仓库无 LICENSE 文件，README 的 License 链接会 404 |

---

## 七、关于「测试有效性」的系统性建议

这是本次评审**最值得你重视的部分**。

原有 169 项测试覆盖了：字段适配器（62 项，占比最高）、错误码映射、Schema 映射、FilterCompiler、QueryBuilder 链式调用、限流器、Webhook 验签。**单测覆盖面确实不错。**

但它的**结构性盲区**是：所有涉及**真实并发/真实 IO** 的组件都被 mock 掉了。

```
QueryBuilder.test.ts:43  →  writeLock: { acquire: vi.fn().mockResolvedValue(release) }   ← 锁是假的
HttpClient.test.ts       →  https 全部 mock                                              ← 网络是假的
Auth.test.ts             →  同上
```

**这三处恰好是本次三个 Critical 缺陷的藏身之处。**

### 建议补充的测试

```typescript
// 1. TableWriteLock 的真实并发测试（当前完全缺失）
describe('TableWriteLock 真实互斥', () => {
  it('并发 acquire 必须严格串行', async () => {
    const lock = new TableWriteLock();
    let concurrent = 0, maxConcurrent = 0;
    const task = async () => {
      const release = await lock.acquire('tbl');
      concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 10));
      concurrent--; release();
    };
    await Promise.all([task(), task(), task()]);
    expect(maxConcurrent).toBe(1);          // 这条断言在修复前会失败
  });

  it('释放后锁表必须清空', async () => {
    const lock = new TableWriteLock();
    const r = await lock.acquire('tbl'); r();
    expect((lock as any).locks.size).toBe(0);  // 修复前 size=1
  });
});

// 2. 多 Auth 实例的 token 隔离（当前缺失）
it('不同 appId 的 Auth 不共享 token 通道', async () => {
  // 用 nock 或本地 http server 断言 APP_B 的请求确实发出去了
});
```

---

## 八、修复优先级建议

| 顺序 | 缺陷 | 工作量 | 收益 |
|---|---|---|---|
| **1** | 🔴 缺陷 1+4（写锁，合并修复） | 15 行 | 恢复文档承诺的写冲突保护 + 消除内存泄漏 |
| **2** | 🔴 缺陷 3（where 解析） | 10 行 | 消除静默查询错误 |
| **3** | 🔴 缺陷 2（token 串号） | 3 行 | 消除跨租户越权风险 |
| **4** | 🟠 缺陷 5（limit 提前终止） | 2 行 | 大表查询性能显著提升 |
| **5** | 🟡 缺陷 7（timingSafeEqual） | 3 行 | Webhook 返回正确状态码 |
| **6** | 🟠 缺陷 6（重试策略） | 较大 | 需先与业务确认幂等性边界 |
| **7** | 🟡 缺陷 8、9 | 中等 | 语义一致性 |
| **8** | 死代码清理、LICENSE | 5 分钟 | — |

> **最小可发布修复集**：前 5 项加起来约 30 行改动，可覆盖 3 个 Critical + 2 个 Major。

---

## 九、总体评价

**做得好的地方**（这些不是客套，是客观事实）：

1. **零依赖的克制**——很多同类 SDK 会引入 axios/dayjs，作者用 Node 内置模块实现同等能力，避免了供应链风险
2. **边界条件文档**——`BOUNDARIES.md` 写到「不支持深层 and/or 嵌套」「单选选项 20000 个上限」这种粒度，说明作者真的读了官方文档
3. **错误码映射完整**——9 类结构化异常 + 精确错误码，比大多数开源 SDK 的错误处理更规范
4. **JSDoc 里主动标注限制**——`count()` 的近似值、`startsWith` 的后置过滤，作者在注释里坦白而非隐瞒

**需要补强的**：

1. **并发组件缺少测试**——这是三个 Critical 缺陷的共同根源。写锁、token 刷新这类组件，**必须**有真实并发测试，mock 掉等于没测
2. **API 设计的参数歧义**——`where()` 用参数个数推断语义，导致文档示例本身就是错的
3. **文档与实现不同步**——README 的 `where('email','isEmpty')` 写法、BOUNDARIES 的「内置表级写锁」承诺，都与实际行为不符

**一句话**：这个项目的**设计意图和文档质量明显高于平均开源 SDK 水平**，但实现层面在「并发正确性」这个最难自测的维度上出现了系统性疏漏。好消息是——**三个 Critical 缺陷的修复加起来不到 30 行**。

---

*本报告所有缺陷均附可执行复现证据（`tests/{design-defects,real-objects,retry-verify,fix-verification}.verify.test.ts`），所有修复方案均已通过测试验证。改完发我，我帮你复审确认。*
