import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import {
  verifyWebhookSignature,
  parseWebhookEvent,
  decryptWebhookBody,
} from '../src/core/Webhook';
import { BitableValidationError } from '../src/error';

const ENCRYPT_KEY = 'test-encrypt-key-123';

function sign(timestamp: string, nonce: string, body: string): string {
  return crypto
    .createHash('sha256')
    .update(timestamp + nonce + ENCRYPT_KEY + body)
    .digest('hex');
}

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ event: 'test' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce-abc';
  const signature = sign(timestamp, nonce, body);

  function makeHeaders(overrides: Record<string, string> = {}) {
    return {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signature,
      ...overrides,
    };
  }

  it('passes with correct signature', () => {
    expect(verifyWebhookSignature(body, makeHeaders(), { encryptKey: ENCRYPT_KEY })).toBe(true);
  });

  it('fails with wrong signature', () => {
    // Must be 64 hex chars to match sha256 digest length (timingSafeEqual requires equal length)
    const wrongSig = '0'.repeat(64);
    expect(
      verifyWebhookSignature(body, makeHeaders({ 'x-lark-signature': wrongSig }), {
        encryptKey: ENCRYPT_KEY,
      }),
    ).toBe(false);
  });

  it('fails when timestamp is expired (>5 min)', () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const oldSig = sign(oldTs, nonce, body);
    expect(
      verifyWebhookSignature(
        body,
        { 'x-lark-request-timestamp': oldTs, 'x-lark-request-nonce': nonce, 'x-lark-signature': oldSig },
        { encryptKey: ENCRYPT_KEY },
      ),
    ).toBe(false);
  });

  it('fails when headers are missing', () => {
    expect(verifyWebhookSignature(body, {}, { encryptKey: ENCRYPT_KEY })).toBe(false);
  });

  it('accepts Buffer rawBody', () => {
    expect(
      verifyWebhookSignature(Buffer.from(body), makeHeaders(), { encryptKey: ENCRYPT_KEY }),
    ).toBe(true);
  });
});

describe('parseWebhookEvent', () => {
  function signedHeaders(body: string): Record<string, string> {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'n1';
    return {
      'x-lark-request-timestamp': ts,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': sign(ts, nonce, body),
    };
  }

  it('parses challenge response', () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'chal-123' });
    const result = parseWebhookEvent(body, signedHeaders(body), { encryptKey: ENCRYPT_KEY });
    expect(result).toEqual({ challenge: 'chal-123' });
  });

  it('throws on bad signature', () => {
    const body = JSON.stringify({ hello: 'world' });
    expect(() =>
      parseWebhookEvent(
        body,
        { 'x-lark-request-timestamp': '1', 'x-lark-request-nonce': 'x', 'x-lark-signature': 'bad' },
        { encryptKey: ENCRYPT_KEY },
      ),
    ).toThrow(BitableValidationError);
  });

  it('throws on non-JSON body after valid signature', () => {
    const body = 'not json';
    expect(() => parseWebhookEvent(body, signedHeaders(body), { encryptKey: ENCRYPT_KEY })).toThrow(
      /不是有效的 JSON/,
    );
  });

  it('validates verificationToken when provided', () => {
    const body = JSON.stringify({
      header: { token: 'good-token', eventType: 'drive.file.bitable_record_changed_v1' },
      event: {},
    });
    expect(() =>
      parseWebhookEvent(body, signedHeaders(body), {
        encryptKey: ENCRYPT_KEY,
        verificationToken: 'wrong-token',
      }),
    ).toThrow(/Verification Token/);

    const result = parseWebhookEvent(body, signedHeaders(body), {
      encryptKey: ENCRYPT_KEY,
      verificationToken: 'good-token',
    });
    expect(result).toBeDefined();
  });
});

describe('decryptWebhookBody', () => {
  it('decrypts AES-256-CBC encrypted body round-trip', () => {
    const key = crypto.createHash('sha256').update(ENCRYPT_KEY).digest();
    const iv = crypto.randomBytes(16);
    const plaintext = JSON.stringify({ hello: 'world' });

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plaintext, 'utf-8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const combined = Buffer.concat([iv, encrypted]);
    const b64 = combined.toString('base64');

    const decrypted = decryptWebhookBody(b64, ENCRYPT_KEY);
    expect(JSON.parse(decrypted)).toEqual({ hello: 'world' });
  });
});
