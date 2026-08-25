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

describe('BudgetBakers client surface', () => {
  it('auto-generates a UUID Idempotency-Key on creates, explicit key wins', async () => {
    const { mock, calls } = fetchQueue([
      { status: 201, body: { sessionId: 's', hostedUrl: 'h', expiresAt: 'e' } },
      { status: 201, body: { sessionId: 's', hostedUrl: 'h', expiresAt: 'e' } },
    ]);
    const scope = bb(mock).client('c1');
    await scope.connectSessions.create({ returnUrl: 'https://x.test/cb' });
    await scope.connectSessions.create({ returnUrl: 'https://x.test/cb', idempotencyKey: 'mine' });
    const auto = (calls[0].init.headers as Record<string, string>)['Idempotency-Key'];
    const explicit = (calls[1].init.headers as Record<string, string>)['Idempotency-Key'];
    expect(auto).toMatch(UUID_RE);
    expect(explicit).toBe('mine');
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
      { status: 200, body: { id: 'conn1' } },
    ]);
    const api = bb(mock);
    await api.partner.getConfig();
    await api.client('c1').connections.get('conn1');
    expect((calls[0].init.headers as Record<string, string>)['X-Client-Id']).toBeUndefined();
    expect((calls[1].init.headers as Record<string, string>)['X-Client-Id']).toBe('c1');
  });

  it('iterates transactions across pages until nextCursor is null', async () => {
    // Raw strings, NOT objects: building this via JSON.stringify would corrupt
    // the 2^53/100 trap in the test itself (float64) before the SDK ever runs.
    const pages = [
      '{"limit":2,"nextCursor":"c2","data":[{"id":"t1","amount":0.10},{"id":"t2","amount":0.20}]}',
      '{"limit":2,"nextCursor":null,"data":[{"id":"t3","amount":90071992547409.93}]}',
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
    expect(amounts).toEqual(['0.10', '0.20', '90071992547409.93']);
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

  it('revoke and delete swallow empty 200 bodies', async () => {
    const emptyOk = vi.fn<typeof globalThis.fetch>(async () => new Response('', { status: 200 }));
    const scope = bb(emptyOk).client('c1');
    await expect(scope.connections.revoke('conn1')).resolves.toBeUndefined();
    await expect(scope.connections.delete('conn1')).resolves.toBeUndefined();
  });
});
