// Webhook signature verification + typed event parsing.
//
// Signature (spec/webhooks-v2.yaml, pinned by contract-tests/fixtures/
// webhooksig.json): X-BB-Signature: t=<unix-ts>,v1=<hex HMAC_SHA256(secret,
// "{t}." + raw_body)>. Constant-time comparison against every active secret
// (two during rotation), ±300 s timestamp window, collect every v1 entry,
// ignore unknown scheme keys. No home-grown deviations (CLAUDE.md rule 6).

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ParsedWebhook, WebhookEventType, WebhookReason } from './types';

export const SIGNATURE_HEADER = 'X-BB-Signature';
export const TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | 'valid'
  | 'invalid_signature'
  | 'timestamp_out_of_tolerance'
  | 'malformed_header';

const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;
const DIGITS = /^[0-9]+$/;

function digest(secret: string, ts: string, rawBody: Buffer): Buffer {
  return createHmac('sha256', secret).update(ts).update('.').update(rawBody).digest();
}

/** Sign rawBody at unix time `ts`; returns the full header value (test/tooling use). */
export function sign(secret: string, ts: number, rawBody: Buffer | string): string {
  const t = String(Math.trunc(ts));
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  return `t=${t},v1=${digest(secret, t, body).toString('hex')}`;
}

interface ParsedHeader {
  ts: string;
  sigs: Buffer[];
}

function parseHeader(header: string): ParsedHeader | null {
  if (header === '') return null;
  let ts = '';
  const sigs: Buffer[] = [];
  for (const element of header.split(',')) {
    const eq = element.indexOf('=');
    if (eq <= 0) return null;
    const key = element.slice(0, eq);
    const value = element.slice(eq + 1);
    if (value === '') return null;
    if (key === 't') {
      if (ts !== '') return null; // duplicate t
      if (!DIGITS.test(value)) return null;
      ts = value;
    } else if (key === 'v1') {
      // Buffer.from(hex) silently truncates bad input — validate first.
      if (!HEX_32_BYTES.test(value)) return null;
      sigs.push(Buffer.from(value, 'hex'));
    }
    // Unknown scheme keys are ignored (forward compatibility).
  }
  if (ts === '' || sigs.length === 0) return null;
  return { ts, sigs };
}

/**
 * Verify a delivery. Pass ALL currently active secrets (the portal shows two
 * during rotation). `now` defaults to the current time; injectable for tests.
 */
export function verify(
  secrets: readonly string[],
  header: string,
  rawBody: Buffer | string,
  now: Date | number = new Date(),
): VerifyResult {
  const parsed = parseHeader(header);
  if (parsed === null) return 'malformed_header';
  const t = Number(parsed.ts);
  if (!Number.isSafeInteger(t)) return 'malformed_header';
  const nowUnix = typeof now === 'number' ? now : Math.trunc(now.getTime() / 1000);
  if (Math.abs(Math.trunc(nowUnix) - t) > TOLERANCE_SECONDS) return 'timestamp_out_of_tolerance';
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  for (const secret of secrets) {
    const expected = digest(secret, parsed.ts, body);
    for (const sig of parsed.sigs) {
      if (sig.length === expected.length && timingSafeEqual(sig, expected)) return 'valid';
    }
  }
  return 'invalid_signature';
}

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'AuthenticationStarted',
  'AuthenticationSuccess',
  'AuthenticationFailed',
  'AuthenticationCanceled',
  'AccountsFetchingStarted',
  'AccountsFetchingSuccess',
  'AccountsFetchingFailed',
  'TransactionsFetchingStarted',
  'TransactionsFetchingSuccess',
  'TransactionsFetchingFailed',
  'ConnectionCreateSuccess',
  'ConnectionCreateFailed',
  'ConnectionRefreshSuccess',
  'ConnectionRefreshFailed',
  'ConnectionDeleted',
  'ConnectionConsentRevoked',
  'ConnectionConsentExpired',
]);

const KNOWN_FIELDS = new Set(['eventId', 'type', 'clientId', 'connectionId', 'createdAt', 'reason']);

/**
 * Parse a delivery body into a typed event. NEVER throws: unknown types pass
 * through as UnknownEvent (respond 2xx and ignore — D11), malformed JSON
 * yields a structured parse error.
 */
export function parseEvent(rawBody: Buffer | string): ParsedWebhook {
  const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { kind: 'parse_error', message: err instanceof Error ? err.message : String(err) };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'parse_error', message: 'webhook body is not a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : '';
  if (!EVENT_TYPES.has(type)) {
    return { kind: 'unknown', type, raw: obj };
  }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!KNOWN_FIELDS.has(k)) extra[k] = v;
  }
  const reason = obj.reason as WebhookReason | undefined;
  return {
    kind: 'event',
    type: type as WebhookEventType,
    eventId: String(obj.eventId ?? ''),
    clientId: String(obj.clientId ?? ''),
    connectionId: String(obj.connectionId ?? ''),
    createdAt: String(obj.createdAt ?? ''),
    reason: reason ?? null,
    extra,
  };
}
