import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartnerApiError, PartnerApiUnreachable } from '../src/errors';
import { Transport } from '../src/transport';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const envelope = (code: string) => ({
  errorDesc: 'x',
  error: { code, message: `msg ${code}` },
  requestId: 'req_test_1',
});

function makeTransport(fetchMock: typeof globalThis.fetch, maxRetries = 3) {
  return new Transport({
    baseUrl: 'https://partner.test.local',
    apiKey: 'sk_test_x',
    retryBaseMs: 10,
    maxRetries,
    fetch: fetchMock,
  });
}

describe('Transport retries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries GET on 5xx and returns the eventual success', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(500, envelope('internal_error')))
      .mockResolvedValueOnce(jsonResponse(500, envelope('internal_error')))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    const promise = makeTransport(fetchMock).request('GET', '/v1/providers');
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('exhausts retries into a typed error', async () => {
    // A Response body is single-read — mint a fresh one per attempt.
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => jsonResponse(500, envelope('internal_error')));
    const promise = makeTransport(fetchMock).request('GET', '/v1/providers');
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'internal_error',
      httpStatus: 500,
      requestId: 'req_test_1',
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('honors Retry-After seconds on 429', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(429, envelope('rate_limited'), { 'Retry-After': '7' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    const promise = makeTransport(fetchMock).request('GET', '/v1/providers');
    await vi.advanceTimersByTimeAsync(6900);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still waiting
    await vi.advanceTimersByTimeAsync(200);
    expect(await promise).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries non-429 4xx (406 stays a single typed error)', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(406, envelope('background_refresh_not_allowed')));
    await expect(makeTransport(fetchMock).request('POST', '/v1/x')).rejects.toMatchObject({
      code: 'background_refresh_not_allowed',
      httpStatus: 406,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry POST without an Idempotency-Key, does with one', async () => {
    const fail500 = () => jsonResponse(500, envelope('internal_error'));
    const noKey = vi.fn<typeof globalThis.fetch>().mockResolvedValue(fail500());
    await expect(makeTransport(noKey).request('POST', '/v1/x', { body: {} })).rejects.toBeInstanceOf(
      PartnerApiError,
    );
    expect(noKey).toHaveBeenCalledTimes(1);

    const withKey = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(jsonResponse(201, { id: 'x' }));
    const promise = makeTransport(withKey).request('POST', '/v1/x', {
      body: {},
      idempotencyKey: 'k1',
    });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ id: 'x' });
    expect(withKey).toHaveBeenCalledTimes(2);
  });
});

describe('Transport errors and headers', () => {
  it('wraps network failures in PartnerApiUnreachable', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('ECONNREFUSED'));
    await expect(makeTransport(fetchMock, 0).request('GET', '/v1/x')).rejects.toBeInstanceOf(
      PartnerApiUnreachable,
    );
  });

  it('prefers the X-Request-Id header over the body requestId', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(404, envelope('not_found'), { 'X-Request-Id': 'req_hdr' }));
    await expect(makeTransport(fetchMock, 0).request('GET', '/v1/x')).rejects.toMatchObject({
      requestId: 'req_hdr',
    });
  });

  it('falls back to status-derived codes for non-envelope bodies (gateway 401/429)', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(makeTransport(fetchMock, 0).request('GET', '/v1/x')).rejects.toMatchObject({
      code: 'unauthorized',
      httpStatus: 401,
    });
  });

  it('sends auth/scope/idempotency headers and parses money losslessly', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"amount":0.10}', { status: 200 }));
    const result = await makeTransport(fetchMock).request<{ amount: string }>('POST', '/v1/x', {
      clientId: 'c1',
      body: { a: 1 },
      idempotencyKey: 'k1',
      query: { limit: 2, skip: undefined },
    });
    expect(result.amount).toBe('0.10');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://partner.test.local/v1/x?limit=2');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('sk_test_x');
    expect(headers['X-Client-Id']).toBe('c1');
    expect(headers['Idempotency-Key']).toBe('k1');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
