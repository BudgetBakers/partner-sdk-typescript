import { describe, expect, it, vi } from 'vitest';
import { BudgetBakers } from '../src/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fetchQueue(responses: { status: number; body: unknown }[]) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const mock = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    calls.push({ url: input as URL, init: init ?? {} });
    const next = responses.shift() ?? { status: 500, body: { error: { code: 'internal_error' } } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  return { mock, calls };
}

function bb(mock: typeof globalThis.fetch) {
  return new BudgetBakers({
    apiKey: 'sk_test_x',
    baseUrl: 'https://partner.test.local',
    retryBaseMs: 1,
    maxRetries: 0,
    fetch: mock,
  });
}

const header = (call: { init: RequestInit }, name: string) =>
  (call.init.headers as Record<string, string>)[name];

describe('BudgetBakers client surface', () => {
  it('auto-generates a UUID Idempotency-Key on creates, explicit key wins', async () => {
    const { mock, calls } = fetchQueue([
      { status: 201, body: { sessionId: 's', hostedUrl: 'h', expiresAt: 'e' } },
      { status: 201, body: { sessionId: 's', hostedUrl: 'h', expiresAt: 'e' } },
    ]);
    const scope = bb(mock).client('c1');
    await scope.connectSessions.create({ returnUrl: 'https://x.test/cb' });
    await scope.connectSessions.create({ returnUrl: 'https://x.test/cb', idempotencyKey: 'mine' });
    expect(header(calls[0], 'Idempotency-Key')).toMatch(UUID_RE);
    expect(header(calls[1], 'Idempotency-Key')).toBe('mine');
  });

  it('sends connectionId for a reconnect session and omits it otherwise', async () => {
    const { mock, calls } = fetchQueue([
      { status: 201, body: { sessionId: 's', hostedUrl: 'h', expiresAt: 'e' } },
      { status: 201, body: { sessionId: 's', hostedUrl: 'h', expiresAt: 'e' } },
    ]);
    const scope = bb(mock).client('c1');
    await scope.connectSessions.create({ returnUrl: 'https://x.test/cb', connectionId: 'conn1' });
    await scope.connectSessions.create({ returnUrl: 'https://x.test/cb' });
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ connectionId: 'conn1' });
    expect(JSON.parse(calls[1].init.body as string)).not.toHaveProperty('connectionId');
  });

  it('scopes X-Client-Id on client-bound calls only', async () => {
    const { mock, calls } = fetchQueue([
      { status: 200, body: { partnerId: 'p', name: 'n', mode: 'sandbox', capabilities: {}, webhook: {} } },
      { status: 200, body: { data: { id: 'conn1' } } },
    ]);
    const api = bb(mock);
    await api.partner.getConfig();
    await api.client('c1').connections.get('conn1');
    expect(header(calls[0], 'X-Client-Id')).toBeUndefined();
    expect(header(calls[1], 'X-Client-Id')).toBe('c1');
  });

  it('iterates transactions across pages until nextCursor is null', async () => {
    // Raw strings, NOT objects: building this via JSON.stringify would corrupt
    // the 2^53/100 trap in the test itself (float64) before the SDK ever runs.
    // v2 serves amounts as strings; bare numbers (v1 style) stay supported.
    const pages = [
      '{"limit":2,"nextCursor":"c2","data":[{"id":"t1","amount":"0.10"},{"id":"t2","amount":0.20}]}',
      '{"limit":2,"nextCursor":null,"data":[{"id":"t3","amount":"90071992547409.93"},{"id":"t4","amount":"1.005"}]}',
    ];
    const calls: URL[] = [];
    const mock = vi.fn<typeof globalThis.fetch>(async (input) => {
      calls.push(input as URL);
      return new Response(pages.shift() ?? '{}', { status: 200 });
    });
    const amounts: (string | null)[] = [];
    for await (const tx of bb(mock).client('c1').accounts.transactions('a1', { limit: 2 })) {
      amounts.push(tx.amount ?? null);
    }
    expect(amounts).toEqual(['0.10', '0.20', '90071992547409.93', '1.005']);
    expect(calls[0].pathname).toBe('/v2/accounts/a1/transactions');
    expect(calls[1].toString()).toContain('nextCursor=c2');
  });

  it('waitForTerminal polls until a terminal state and reports each poll', async () => {
    const session = (state: string, extra: Record<string, unknown> = {}) => ({
      status: 200,
      body: { sessionId: 's1', state, ...extra },
    });
    const { mock } = fetchQueue([
      session('AwaitingBankSelection'),
      session('Fetching'),
      session('Completed', { connectionId: 'conn1', resultCode: 'Ok' }),
    ]);
    const seen: string[] = [];
    const finished = await bb(mock)
      .client('c1')
      .connectSessions.waitForTerminal('s1', {
        pollIntervalMs: 1,
        maxPolls: 10,
        onPoll: (polled) => seen.push(polled.state),
      });
    expect(seen).toEqual(['AwaitingBankSelection', 'Fetching', 'Completed']);
    expect(finished.connectionId).toBe('conn1');
  });

  it('revoke and delete swallow empty 200/204 bodies', async () => {
    const emptyOk = vi.fn<typeof globalThis.fetch>(async () => new Response('', { status: 200 }));
    const scope = bb(emptyOk).client('c1');
    await expect(scope.connections.revoke('conn1')).resolves.toBeUndefined();
    await expect(scope.connections.delete('conn1')).resolves.toBeUndefined();
    const noContent = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    await expect(bb(noContent).client('c1').delete()).resolves.toBeUndefined();
  });
});

describe('reads and creates on /v2, lifecycle actions on /v1', () => {
  it.each([
    ['partner.getConfig', 'GET', '/v2/partner/config', (api: BudgetBakers) => api.partner.getConfig()],
    ['providers.pages', 'GET', '/v2/providers', (api: BudgetBakers) => api.providers.pages().next()],
    [
      'clients.create',
      'POST',
      '/v2/clients',
      (api: BudgetBakers) => api.clients.create({ email: 'u@x.test', countryCode: 'CZ' }),
    ],
    ['clients.get', 'GET', '/v2/clients/c1', (api: BudgetBakers) => api.clients.get('c1')],
    ['clients.getByExternalId', 'GET', '/v2/clients', (api: BudgetBakers) => api.clients.getByExternalId('u')],
    ['client.delete', 'DELETE', '/v2/clients/c1', (api: BudgetBakers) => api.client('c1').delete()],
    ['connections.get', 'GET', '/v2/connections/x1', (api: BudgetBakers) => api.client('c1').connections.get('x1')],
    [
      'connections.accountPages',
      'GET',
      '/v2/connections/x1/accounts',
      (api: BudgetBakers) => api.client('c1').connections.accountPages('x1').next(),
    ],
    ['accounts.get', 'GET', '/v2/accounts/a1', (api: BudgetBakers) => api.client('c1').accounts.get('a1')],
    [
      'accounts.transactionPages',
      'GET',
      '/v2/accounts/a1/transactions',
      (api: BudgetBakers) => api.client('c1').accounts.transactionPages('a1').next(),
    ],
    [
      'connectSessions.create',
      'POST',
      '/v2/connect-sessions',
      (api: BudgetBakers) => api.client('c1').connectSessions.create({ returnUrl: 'https://x.test/cb' }),
    ],
    ['connectSessions.get', 'GET', '/v2/connect-sessions/s1', (api: BudgetBakers) => api.client('c1').connectSessions.get('s1')],
    ['connections.create', 'POST', '/v1/connections', (api: BudgetBakers) => api.client('c1').connections.create({ providerId: 'p' })],
    ['connections.delete', 'DELETE', '/v1/connections/x1', (api: BudgetBakers) => api.client('c1').connections.delete('x1')],
    ['connections.refresh', 'POST', '/v1/connections/x1/refresh', (api: BudgetBakers) => api.client('c1').connections.refresh('x1')],
    ['connections.reconnect', 'POST', '/v1/connections/x1/reconnect', (api: BudgetBakers) => api.client('c1').connections.reconnect('x1')],
    ['connections.revoke', 'PATCH', '/v1/connections/x1/revoke', (api: BudgetBakers) => api.client('c1').connections.revoke('x1')],
  ])('%s calls %s %s', async (_name, method, path, call) => {
    const { mock, calls } = fetchQueue([
      { status: 200, body: { data: { id: 'any' }, limit: 1, nextCursor: null, sessionId: 's', state: 'Completed' } },
    ]);
    await call(bb(mock));
    expect(calls[0].init.method).toBe(method);
    expect(calls[0].url.pathname).toBe(path);
  });

  it('unwraps the { data } envelope on single-resource reads and creates', async () => {
    const { mock } = fetchQueue([
      { status: 201, body: { data: { id: 'c1', externalId: 'u' } } },
      { status: 200, body: { data: { id: 'c1' } } },
      { status: 200, body: { data: { id: 'x1', state: 'Active', consentExpiresAt: '2026-10-27T00:00:00Z' } } },
      { status: 200, body: { data: { id: 'a1', subscriptionStatus: 'Active' } } },
    ]);
    const api = bb(mock);
    expect((await api.clients.create({ email: 'u@x.test', countryCode: 'CZ', externalId: 'u' })).id).toBe('c1');
    expect((await api.clients.get('c1')).id).toBe('c1');
    const conn = await api.client('c1').connections.get('x1');
    expect(conn).toEqual({ id: 'x1', state: 'Active', consentExpiresAt: '2026-10-27T00:00:00Z' });
    expect((await api.client('c1').accounts.get('a1')).subscriptionStatus).toBe('Active');
  });

  it('rejects a bare body where the envelope is required', async () => {
    const { mock } = fetchQueue([{ status: 201, body: { id: 'c1' } }]);
    await expect(bb(mock).clients.create({ email: 'u@x.test', countryCode: 'CZ' })).rejects.toThrow(
      /envelope/,
    );
  });

  it('clients.get sends the client id as X-Client-Id (v2 client scoping)', async () => {
    const { mock, calls } = fetchQueue([{ status: 200, body: { data: { id: 'c1' } } }]);
    await bb(mock).clients.get('c1');
    expect(header(calls[0], 'X-Client-Id')).toBe('c1');
  });

  it('getByExternalId returns the single page item, or null on an empty page', async () => {
    const { mock, calls } = fetchQueue([
      { status: 200, body: { limit: 100, nextCursor: null, data: [{ id: 'c1', externalId: 'u' }] } },
      { status: 200, body: { limit: 100, nextCursor: null, data: [] } },
    ]);
    const api = bb(mock);
    expect(await api.clients.getByExternalId('u')).toEqual({ id: 'c1', externalId: 'u' });
    expect(await api.clients.getByExternalId('nobody')).toBeNull();
    expect(calls[0].url.searchParams.get('externalId')).toBe('u');
  });

  it('listAccounts walks every page of the accounts envelope', async () => {
    const { mock, calls } = fetchQueue([
      { status: 200, body: { limit: 2, nextCursor: 'acc2', data: [{ id: 'a1', subscriptionStatus: 'Active' }, { id: 'a2', subscriptionStatus: 'Disabled' }] } },
      { status: 200, body: { limit: 2, nextCursor: null, data: [{ id: 'a3', subscriptionStatus: 'Active' }] } },
    ]);
    const accounts = await bb(mock).client('c1').connections.listAccounts('x1');
    expect(accounts.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(calls[1].url.searchParams.get('nextCursor')).toBe('acc2');
  });

  it('encodes the v2 transaction filters, repeating variableSymbol', async () => {
    const { mock, calls } = fetchQueue([{ status: 200, body: { limit: 1, nextCursor: null, data: [] } }]);
    await bb(mock)
      .client('c1')
      .accounts.transactionPages('a1', {
        limit: 5,
        sort: 'amount',
        order: 'asc',
        dateFrom: '2026-07-01',
        recordState: 'Cleared',
        variableSymbol: ['888', '456'],
        sinceSeq: 9002,
      })
      .next();
    const q = calls[0].url.searchParams;
    expect(q.getAll('variableSymbol')).toEqual(['888', '456']);
    expect(q.get('sort')).toBe('amount');
    expect(q.get('order')).toBe('asc');
    expect(q.get('dateFrom')).toBe('2026-07-01');
    expect(q.get('recordState')).toBe('Cleared');
    expect(q.get('sinceSeq')).toBe('9002');
    expect(q.get('limit')).toBe('5');
  });
});
