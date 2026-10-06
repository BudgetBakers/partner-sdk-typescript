// HTTP transport: auth headers, lossless body parsing, typed errors, and
// retries with exponential backoff + jitter on 429/5xx honoring Retry-After.
// POST is retried only when an Idempotency-Key makes the replay safe.

import { parseErrorEnvelope, PartnerApiUnreachable } from './errors';
import { parseBody } from './lossless';

export interface TransportOptions {
  baseUrl: string;
  apiKey: string;
  /** Base delay for exponential backoff (delay = base * 2^attempt ± jitter). */
  retryBaseMs: number;
  /** Retries after the initial attempt on 429/5xx. */
  maxRetries: number;
  /** Injectable for tests; defaults to globalThis.fetch. */
  fetch: typeof globalThis.fetch;
}

export interface RequestOptions {
  clientId?: string;
  /** Array values are repeated (`?k=a&k=b`), the v2 encoding for list parameters. */
  query?: Record<string, string | number | readonly string[] | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

const RETRYABLE_METHODS = new Set(['GET', 'DELETE', 'PATCH', 'PUT']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Unwrap the v2 single-resource envelope `{ "data": ... }`. */
export function unwrapData<T>(body: unknown): T {
  if (body !== null && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }
  throw new TypeError('partner API: expected a { data } envelope');
}

export class Transport {
  constructor(private readonly opts: TransportOptions) {}

  /** request() for v2 single-resource operations: returns the envelope's `data`. */
  async requestData<T>(method: string, path: string, req: RequestOptions = {}): Promise<T> {
    return unwrapData<T>(await this.request<unknown>(method, path, req));
  }

  async request<T>(method: string, path: string, req: RequestOptions = {}): Promise<T> {
    const url = new URL(this.opts.baseUrl + path);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
      } else {
        url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Api-Key': this.opts.apiKey,
    };
    if (req.clientId !== undefined) headers['X-Client-Id'] = req.clientId;
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';
    if (req.idempotencyKey !== undefined) headers['Idempotency-Key'] = req.idempotencyKey;

    const canRetry = RETRYABLE_METHODS.has(method) || req.idempotencyKey !== undefined;

    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.opts.fetch(url, {
          method,
          headers,
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          signal: req.signal,
        });
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') throw cause;
        throw new PartnerApiUnreachable(cause);
      }

      const text = await res.text();
      if (res.ok) {
        return (text === '' ? undefined : parseBody(text)) as T;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && canRetry && attempt < this.opts.maxRetries) {
        const retryAfter = res.headers.get('Retry-After');
        const delayMs =
          retryAfter !== null && /^\d+$/.test(retryAfter)
            ? Number(retryAfter) * 1000
            : // Exponential backoff with ±25% jitter to avoid thundering herds.
              this.opts.retryBaseMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }

      throw parseErrorEnvelope(res.status, text, res.headers.get('X-Request-Id'));
    }
  }
}
