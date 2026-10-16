/**
 * Webhook 事件验签与解析
 *
 * 支持飞书事件回调的 SHA-256 签名校验和 AES-256-CBC 解密。
 * 依据官方文档：https://open.larkoffice.com/document/event-subscription-guide/callback-subscription/receive-and-handle-callbacks
 */

import * as crypto from 'crypto';
import { BitableValidationError } from '../error';
import type { BitableWebhookEvent, WebhookVerifyOptions } from '../types';

/**
 * 验证 Webhook 回调的签名
 *
 * 算法：signature = sha256(timestamp + nonce + encrypt_key + raw_body)
 * 比对请求头 X-Lark-Signature
 *
 * @param rawBody 原始请求体（未解析的字符串或 Buffer）
 * @param headers 请求头（包含 X-Lark-Request-Timestamp, X-Lark-Request-Nonce, X-Lark-Signature）
 * @param options 验签配置
 * @returns 验签是否通过
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  options: WebhookVerifyOptions,
): boolean {
  const timestamp = getHeader(headers, 'x-lark-request-timestamp');
  const nonce = getHeader(headers, 'x-lark-request-nonce');
  const signature = getHeader(headers, 'x-lark-signature');

  if (!timestamp || !nonce || !signature) {
    return false;
  }

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : rawBody;
  const computed = crypto
    .createHash('sha256')
    .update(timestamp + nonce + options.encryptKey + bodyStr)
    .digest('hex');

  // 时间戳防重放：与当前时间差超过 5 分钟视为无效
  const timestampMs = parseInt(timestamp, 10) * 1000;
  if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

/**
 * 解密 AES-256-CBC 加密的回调体
 *
 * key = sha256(encrypt_key)，前 16 字节为 IV，其余为密文
 *
 * @param encryptedBody base64 编码的加密体
 * @param encryptKey Encrypt Key
 * @returns 解密后的 JSON 字符串
 */
export function decryptWebhookBody(encryptedBody: string, encryptKey: string): string {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const encrypted = Buffer.from(encryptedBody, 'base64');
  const iv = encrypted.subarray(0, 16);
  const ciphertext = encrypted.subarray(16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf-8');
}

/**
 * 解析并验证 Webhook 回调
 *
 * 完整流程：验签 → 可选解密 → 解析 JSON → 验证 token
 *
 * @param rawBody 原始请求体
 * @param headers 请求头
 * @param options 配置
 * @returns 解析后的事件对象
 * @throws BitableValidationError 验签失败或解析失败
 */
export function parseWebhookEvent(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  options: WebhookVerifyOptions,
): BitableWebhookEvent | { challenge: string } {
  // 验签
  if (!verifyWebhookSignature(rawBody, headers, options)) {
    throw new BitableValidationError('Webhook 签名验证失败', 1254001, 403);
  }

  let bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : rawBody;

  // AES 解密
  if (options.enableEncryption) {
    try {
      const parsed = JSON.parse(bodyStr);
      if (parsed.encrypt) {
        bodyStr = decryptWebhookBody(parsed.encrypt, options.encryptKey);
      }
    } catch {
      // 非加密格式，直接使用
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bodyStr);
  } catch {
    throw new BitableValidationError('Webhook 回调体不是有效的 JSON', 1254000, 400);
  }

  // URL 验证（challenge）
  if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
    return { challenge: payload.challenge };
  }

  // Verification Token 校验（较弱方式）
  if (options.verificationToken) {
    const header = payload.header as Record<string, unknown> | undefined;
    const headerToken = header?.token as string | undefined;
    const bodyToken = payload.token as string | undefined;
    const token = headerToken || bodyToken;
    if (token !== options.verificationToken) {
      throw new BitableValidationError('Webhook Verification Token 不匹配', 1254001, 403);
    }
  }

  return payload as unknown as BitableWebhookEvent;
}

/**
 * 从 headers 中安全获取指定头的值（不区分大小写）
 */
function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}
