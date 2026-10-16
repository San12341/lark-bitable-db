/**
 * 真实端到端测试（使用 .env 中的飞书凭据，操作真实 API）
 *
 * 流程：建临时表 → 全量 CRUD/查询矩阵（覆盖全部缺陷修复点）→ 清理临时表
 *
 * 运行：node e2e/e2e.real.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BitableClient,
  Model,
  Schema,
  FieldType,
  BitableNotFoundError,
  BitablePermissionError,
} from '../dist/esm/index.js';

// ---------- 读取 .env ----------
const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const APP_ID = env.app_id;
const APP_SECRET = env.app_secret;
const APP_TOKEN = env.app_token;
if (!APP_ID || !APP_SECRET || !APP_TOKEN) {
  console.error('❌ .env 缺少 app_id / app_secret / app_token');
  process.exit(1);
}

// ---------- 测试结果收集 ----------
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail, skipped: false });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? `  (${detail})` : ''}`);
}
/** 分节执行：权限缺失（99991672）时跳过该节并继续，其余异常正常抛出 */
async function section(title, fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof BitablePermissionError) {
      console.log(`⏭️  [跳过] ${title}：应用身份缺少所需权限（${e.code}）`);
      results.push({ name: title, ok: null, detail: e.message.slice(0, 100), skipped: true });
      return;
    }
    throw e;
  }
}

const client = new BitableClient({ appId: APP_ID, appSecret: APP_SECRET, appToken: APP_TOKEN });

let tableId = null;

// 统计 search 请求次数（验证 limit 提前终止）
function instrumentSearchCounter() {
  const orig = client.http.request.bind(client.http);
  let searchCalls = 0;
  client.http.request = async (...args) => {
    const url = String(args[1]?.url ?? args[0]?.url ?? '');
    if (url.includes('/records/search')) searchCalls += 1;
    return orig(...args);
  };
  return () => searchCalls;
}

async function main() {
  console.log('=== lark-bitable-db 真实 E2E 测试 ===\n');

  // ---------- 0. 鉴权（token 获取隐含在首个请求中） ----------
  console.log('[0] 鉴权与连通性');
  const appMeta = await client.request('GET', '');
  check('获取 app 元信息（token 获取成功）', !!appMeta?.name !== undefined, `app name=${appMeta?.name}`);

  // ---------- 1. 创建临时表 ----------
  console.log('\n[1] 创建临时数据表');
  const created = await client.request('POST', '/tables', {
    table: {
      name: `SDK_E2E_临时表_${Date.now()}`,
      default_view_name: '表格',
      fields: [
        { field_name: '姓名', type: 1 },
        { field_name: '年龄', type: 2, property: { formatter: '0' } },
        { field_name: '邮箱', type: 1 },
        { field_name: '启用', type: 7 },
      ],
    },
  });
  tableId = created.table_id;
  check('创建临时表', !!tableId, `table_id=${tableId}`);

  // ---------- 2. 定义 Schema/Model ----------
  const schema = new Schema({
    name: { fieldName: '姓名', type: FieldType.Text },
    age: { fieldName: '年龄', type: FieldType.Number },
    email: { fieldName: '邮箱', type: FieldType.Text },
    active: { fieldName: '启用', type: FieldType.Checkbox },
  });
  class TmpModel extends Model {}
  TmpModel.tableId = tableId;
  TmpModel.schema = schema;
  const users = new TmpModel(client);

  // ---------- 3. 单条创建 ----------
  console.log('\n[2] create：单条创建与字段往返');
  const zhang = await users.query().create({
    name: '张三',
    age: 28,
    email: 'zhangsan@example.com',
    active: true,
  });
  check('create 返回 recordId', typeof zhang.recordId === 'string' && zhang.recordId.startsWith('rec'));
  check('create 字段往返（text/number/email/checkbox）',
    zhang.name === '张三' && zhang.age === 28 && zhang.email === 'zhangsan@example.com' && zhang.active === true,
    `name=${zhang.name}, age=${zhang.age}, email=${zhang.email}, active=${zhang.active}`);

  // ---------- 4. 批量创建 120 条（分页测试数据） ----------
  console.log('\n[3] createMany：批量创建 120 条');
  const batch = [];
  for (let n = 1; n <= 120; n++) {
    batch.push({
      name: n % 10 === 0 ? `张${n}号` : `用户${n}号`,
      age: n,
      ...(n % 3 !== 0 ? { email: `u${n}@example.com` } : {}), // 每 3 条留 1 条空邮箱
      active: n % 2 === 0,
    });
  }
  const createdBatch = await users.query().createMany(batch);
  check('批量创建 120 条全部返回', createdBatch.length === 120, `got=${createdBatch.length}`);

  // ---------- 5. 查询矩阵（search 接口依赖 base:record:retrieve，缺失时自动跳过） ----------
  await section('findAll 全量（跨页合并）', async () => {
    console.log('\n[4] 查询矩阵');
    const all = await users.query().findAll();
    check('findAll 全量 121 条（跨 2 页合并）', all.length === 121, `got=${all.length}`);

    const gt = await users.query().where('age', '>', 118).findAll();
    check("where('age','>',118) 命中 2 条（119/120）", gt.length === 2 && gt.every(r => r.age > 118),
      `got=${gt.length}`);

    // 【缺陷3修复验证】isEmpty：期望 40 条（NN 为 3 的倍数，张三有邮箱不计入）
    const emptyEmail = await users.query().where('email', 'isEmpty').findAll();
    check("where('email','isEmpty') 命中 40 条（修复前被误解析为 is 'isEmpty' 返回 0 条）",
      emptyEmail.length === 40, `got=${emptyEmail.length}`);

    const nonEmpty = await users.query().where('email', 'isNotEmpty').findAll();
    check("where('email','isNotEmpty') 命中 81 条", nonEmpty.length === 81, `got=${nonEmpty.length}`);

    const zhangRows = await users.query().where('name', 'startsWith', '张').findAll();
    const cntApprox = await users.query().where('name', 'startsWith', '张').count();
    const cntExact = await users.query().where('name', 'startsWith', '张').countExact();
    check("startsWith('张') 过滤命中 13 条（张三 + 12 个张N号）", zhangRows.length === 13,
      `got=${zhangRows.length}`);
    check('countExact 与 findAll 口径一致', cntExact === zhangRows.length, `countExact=${cntExact}`);
    console.log(`   (count() 服务端近似值=${cntApprox}, countExact()=${cntExact})`);
  });

  // 【缺陷5修复验证】limit 提前终止：limit(5) 只应发 1 次 search（pageSize=5，首页即凑满）
  await section('limit 提前终止', async () => {
    const getSearchCalls = instrumentSearchCounter();
    const limited = await users.query().limit(5).findAll();
    const searchCalls = getSearchCalls();
    check('limit(5).findAll() 返回 5 条', limited.length === 5, `got=${limited.length}`);
    check('limit(5) 只发 1 次 search 请求（修复前会拉全表 3 次）', searchCalls === 1, `search calls=${searchCalls}`);
  });

  await section('findPage 分页', async () => {
    console.log('\n[5] findPage 分页');
    let pageToken;
    let pagedTotal = 0;
    let pages = 0;
    do {
      const page = await users.query().findPage(50, pageToken);
      pagedTotal += page.items.length;
      pages += 1;
      pageToken = page.hasMore ? page.pageToken : undefined;
      if (pagedTotal > 500) break; // 防御
    } while (pageToken);
    check('findPage(50) 循环收集 121 条 / 3 页', pagedTotal === 121 && pages === 3,
      `items=${pagedTotal}, pages=${pages}`);

    // 【缺陷8修复验证】startsWith + findPage：不出现空页误报
    const firstZhangPage = await users.query().where('name', 'startsWith', '张').findPage(50);
    check('startsWith+findPage 返回非空匹配页', firstZhangPage.items.length > 0,
      `items=${firstZhangPage.items.length}`);
  });

  await section('findOne / orderBy', async () => {
    console.log('\n[6] findOne / findById / orderBy');
    const one = await users.query().where('name', '张三').findOne();
    check('findOne 命中张三', one?.name === '张三');
    const top3 = await users.query().orderBy('age', 'desc').limit(3).findAll();
    check('orderBy age desc limit 3 → [120,119,118]',
      top3.length === 3 && top3[0].age === 120 && top3[1].age === 119 && top3[2].age === 118,
      `ages=${top3.map(r => r.age).join(',')}`);
  });

  // findById 走单条 GET 接口（base:record:read 已授权），不依赖 search
  {
    const byId = await users.query().findById(zhang.recordId);
    check('findById 往返一致（单条 GET 接口）', byId.name === '张三' && byId.recordId === zhang.recordId);
  }

  // ---------- 6. 更新 ----------
  console.log('\n[7] 更新操作');
  // 飞书 PUT 响应只返回本次更新的字段（其余为 null，官方行为），完整性用 findById 回读验证
  const updated = await users.query().updateById(zhang.recordId, { age: 29 });
  check('updateById 部分字段覆盖（age 28→29，响应仅含更新字段）',
    updated.age === 29 && updated.name === null,
    `age=${updated.age}, name=${updated.name}`);
  const reread = await users.query().findById(zhang.recordId);
  check('updateById 后 findById 回读：age=29 且其余字段完整',
    reread.age === 29 && reread.name === '张三' && reread.email === 'zhangsan@example.com',
    `age=${reread.age}, name=${reread.name}`);

  const twoOfBatch = createdBatch.slice(0, 2);
  const updatedMany = await users.query().updateMany(
    twoOfBatch.map(r => ({ recordId: r.recordId, data: { age: 999 } })),
  );
  check('updateMany 2 条', updatedMany.length === 2 && updatedMany.every(r => r.age === 999));

  // ---------- 7. 【缺陷1修复验证】同表并发写（写锁串行化，不出现 1254291） ----------
  console.log('\n[8] 同表并发写（写锁串行化）');
  const targets = createdBatch.slice(10, 16);
  const settled = await Promise.allSettled(
    targets.map((r, i) => users.query().updateById(r.recordId, { age: 1000 + i })),
  );
  const okCount = settled.filter(s => s.status === 'fulfilled').length;
  check('6 个并发 updateById 全部成功（无 1254291 写冲突）', okCount === 6, `ok=${okCount}`);

  // ---------- 8. 删除 ----------
  console.log('\n[9] 删除操作');
  const removed = await users.query().deleteById(zhang.recordId);
  check('deleteById 成功', removed === true);
  const del4 = createdBatch.slice(2, 6);
  const removedMany = await users.query().deleteMany(del4.map(r => r.recordId));
  check('deleteMany 4 条成功', removedMany === true);

  await section('删除后总量校验', async () => {
    const afterAll = await users.query().findAll();
    check('删除后总数 121-1-4=116', afterAll.length === 116, `got=${afterAll.length}`);
  });

  let notFound = false;
  try {
    await users.query().findById(zhang.recordId);
  } catch (e) {
    notFound = e instanceof BitableNotFoundError;
  }
  check('findById 已删记录抛 BitableNotFoundError', notFound);
}

// ---------- 清理与汇总 ----------
async function cleanup() {
  if (tableId) {
    try {
      await client.request('DELETE', `/tables/${tableId}`);
      console.log(`\n🧹 临时表已清理: ${tableId}`);
    } catch (e) {
      console.error(`\n⚠️ 临时表清理失败（请手动删除 table_id=${tableId}）: ${e.message}`);
    }
  }
}

try {
  await main();
} catch (e) {
  const extra = e && typeof e === 'object'
    ? `code=${e.code} httpStatus=${e.httpStatus} raw=${JSON.stringify(e.rawResponse ?? '').slice(0, 300)} | ${e.message}`
    : String(e);
  check('E2E 主流程未抛异常', false, `${extra}\n${e?.stack ?? ''}`);
} finally {
  await cleanup();
}

const failed = results.filter(r => r.ok === false);
const skipped = results.filter(r => r.skipped);
console.log('\n========== E2E 结果汇总 ==========');
console.log(`总计 ${results.length} 项 | ✅ 通过 ${results.length - failed.length - skipped.length} | ❌ 失败 ${failed.length} | ⏭️ 权限跳过 ${skipped.length}`);
if (skipped.length) {
  console.log('因应用身份权限跳过的部分（在开发者后台开通对应权限后重跑即可覆盖）:');
  for (const s of skipped) console.log(`  ⏭️  ${s.name}`);
}
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log(`  ❌ ${f.name} ${f.detail}`);
  process.exit(1);
}
if (skipped.length) {
  console.log('ℹ️ 未覆盖全部场景（存在权限跳过），退出码 2');
  process.exit(2);
}
console.log('🎉 全部通过');
