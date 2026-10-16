/**
 * 真实 API 管线验证（部分 E2E）
 *
 * 背景：当前应用的 bitable 权限（base:*）仅开通了「用户身份」（user_access_token），
 * 未开通「应用身份」（tenant_access_token），SDK 以应用身份调用 bitable API 会被拒。
 * 完整 bitable E2E（e2e.real.mjs）需先在开发者后台开通应用身份权限并发布版本。
 *
 * 本脚本验证 SDK 在真实网络下的完整请求管线：
 *   1. 真实 tenant_access_token 获取（Auth 模块）
 *   2. 真实成功路径：经 HttpClient 全管线（限流→鉴权注入→信封解析）调用已授权 API
 *   3. 真实错误路径：bitable API 返回 99991672 → SDK 正确映射为 BitablePermissionError
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BitableClient, BitablePermissionError, verifyWebhookSignature } from '../dist/esm/index.js';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? `  (${detail})` : ''}`);
}

const client = new BitableClient({
  appId: env.app_id,
  appSecret: env.app_secret,
  appToken: env.app_token,
});

async function main() {
  console.log('=== 真实 API 管线验证（部分 E2E）===\n');

  // 1. 真实 token 获取
  const token = await client.auth.getToken();
  check('Auth：真实获取 tenant_access_token', typeof token === 'string' && token.startsWith('t-'),
    `token=${token.slice(0, 8)}...`);
  const token2 = await client.auth.getToken();
  check('Auth：token 内存缓存生效（未过期不重新请求）', token2 === token);

  // 2. 真实成功路径：HttpClient 全管线调用已授权 API（im:chat:read 为 tenant 身份）
  const resp = await client.http.request({
    method: 'GET',
    url: 'https://open.feishu.cn/open-apis/im/v1/chats?page_size=5',
    isWrite: false,
  });
  const chatCount = resp.data?.data?.items?.length ?? 0;
  check('HttpClient：真实成功路径（限流→鉴权→信封解析）', resp.status === 200 && resp.data.code === 0,
    `HTTP ${resp.status}, 读取到 ${chatCount} 个会话`);

  // 3. bitable API：有权限时验证成功路径；无权限时验证 99991672 错误映射
  try {
    const meta = await client.request('GET', '');
    check('bitable：应用身份可读取多维表格元信息（成功路径）', !!meta, `name=${meta?.name ?? ''}`);
  } catch (e) {
    const permErr = e;
    check('错误映射：bitable 99991672 → BitablePermissionError',
      permErr instanceof BitablePermissionError && permErr.code === 99991672,
      `code=${permErr?.code}, httpStatus=${permErr?.httpStatus}`);
  }

  // 4. Webhook 验签真实加密往返（离线 crypto，但用真实算法/真实长度签名）
  const crypto = await import('node:crypto');
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
  const sig = crypto.createHash('sha256').update(ts + 'nonce1' + 'ekey' + body).digest('hex');
  check('Webhook：真实 SHA-256 验签通过', verifyWebhookSignature(body, {
    'x-lark-request-timestamp': ts,
    'x-lark-request-nonce': 'nonce1',
    'x-lark-signature': sig,
  }, { encryptKey: 'ekey' }) === true);
  check('Webhook：长度不等的伪造签名返回 false（不抛异常）',
    verifyWebhookSignature(body, {
      'x-lark-request-timestamp': ts,
      'x-lark-request-nonce': 'nonce1',
      'x-lark-signature': 'deadbeef',
    }, { encryptKey: 'ekey' }) === false);
}

try {
  await main();
} catch (e) {
  check('主流程未抛异常', false, e?.stack ?? String(e));
}

const failed = results.filter(r => !r.ok);
console.log(`\n===== 管线验证结果：${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  for (const f of failed) console.log(`  ❌ ${f.name}`);
  process.exit(1);
}
