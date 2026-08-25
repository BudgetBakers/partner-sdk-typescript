// Conformance driver (contract-tests/PROTOCOL.md v1). Every step goes through
// the SDK's PUBLIC surface — the driver never issues HTTP itself. Subcommands:
// probe | scenario | webhooksig | events.

import { readFileSync } from 'node:fs';
import { BudgetBakers, type ClientScope } from '../client';
import { sumAmounts, type DecimalString } from '../decimal';
import { PartnerApiError } from '../errors';
import { parseEvent, verify } from '../webhooks';
import type { Account, ConnectSession } from '../types';

const IDENTITY = { lang: 'typescript', sdk: '@budgetbakers/partner-sdk', version: '0.1.0' };

interface DriverConfig {
  retryBaseMs: number;
  maxRetries: number;
  pollIntervalMs: number;
  maxPolls: number;
}

interface Step {
  id: string;
  op: string;
  args?: Record<string, unknown>;
  save?: Record<string, string>;
}

interface JournalStep {
  id: string;
  op: string;
  ok?: unknown;
  error?: { code: string; httpStatus: number; requestId: string | null };
  skipped?: string;
  crash?: string;
}

class UnresolvedVar extends Error {
  constructor(readonly varName: string) {
    super(`unresolved var ${varName}`);
  }
}

const s = (args: Record<string, unknown>, key: string): string => String(args[key]);
const opt = (args: Record<string, unknown>, key: string): string | undefined =>
  args[key] === undefined ? undefined : String(args[key]);

function accountView(a: Account) {
  return {
    id: a.id ?? null,
    type: a.type ?? null,
    balance: a.balance ?? null,
    currencyCode: a.currencyCode ?? null,
    iban: a.iban ?? null,
  };
}

type OpFn = (bb: BudgetBakers, scope: (a: Record<string, unknown>) => ClientScope, args: Record<string, unknown>, config: DriverConfig) => Promise<unknown>;

const OPS: Record<string, OpFn> = {
  'partner.getConfig': (bb) => bb.partner.getConfig(),

  'providers.listAll': async (bb, _scope, args) => {
    const ids: unknown[] = [];
    let count = 0;
    let pages = 0;
    for await (const page of bb.providers.pages({
      country: opt(args, 'country'),
      limit: args.limit as number | undefined,
    })) {
      pages += 1;
      count += page.data.length;
      ids.push(...page.data.map((p) => p.id));
    }
    return { count, pages, ids };
  },

  'clients.create': (bb, _scope, args) => bb.clients.create(args),
  'clients.get': (bb, _scope, args) => bb.clients.get(s(args, 'clientId')),
  'clients.getByExternalId': (bb, _scope, args) => bb.clients.getByExternalId(s(args, 'externalId')),
  'clients.delete': async (_bb, scope, args) => {
    await scope(args).delete();
    return { deleted: true };
  },

  'connectSessions.create': (_bb, scope, args) =>
    scope(args).connectSessions.create({
      returnUrl: s(args, 'returnUrl'),
      providerId: opt(args, 'providerId'),
      connectionId: opt(args, 'connectionId'),
      idempotencyKey: opt(args, 'idempotencyKey'),
    }),
  'connectSessions.get': (_bb, scope, args) => scope(args).connectSessions.get(s(args, 'sessionId')),
  'connectSessions.waitForTerminal': async (_bb, scope, args, config) => {
    const states: (string | null)[] = [];
    const session: ConnectSession = await scope(args).connectSessions.waitForTerminal(
      s(args, 'sessionId'),
      {
        pollIntervalMs: config.pollIntervalMs,
        maxPolls: config.maxPolls,
        onPoll: (polled) => states.push(polled.state ?? null),
      },
    );
    return {
      states,
      state: session.state ?? null,
      connectionId: session.connectionId ?? null,
      resultCode: session.resultCode ?? null,
      error: session.error ?? null,
    };
  },

  'connections.create': (_bb, scope, args) =>
    scope(args).connections.create({
      providerId: s(args, 'providerId'),
      idempotencyKey: opt(args, 'idempotencyKey'),
    }),
  'connections.get': (_bb, scope, args) => scope(args).connections.get(s(args, 'connectionId')),
  'connections.delete': async (_bb, scope, args) => {
    await scope(args).connections.delete(s(args, 'connectionId'));
    return { deleted: true };
  },
  'connections.refresh': async (_bb, scope, args) => {
    const res = await scope(args).connections.refresh(s(args, 'connectionId'));
    return { status: res.status, nextRefreshPossibleAt: res.nextRefreshPossibleAt ?? null };
  },
  'connections.reconnect': (_bb, scope, args) =>
    scope(args).connections.reconnect(s(args, 'connectionId'), {
      idempotencyKey: opt(args, 'idempotencyKey'),
    }),
  'connections.revoke': async (_bb, scope, args) => {
    await scope(args).connections.revoke(s(args, 'connectionId'));
    return { revoked: true };
  },

  'accounts.list': async (_bb, scope, args) => {
    const accounts = await scope(args).connections.listAccounts(s(args, 'connectionId'));
    return { count: accounts.length, accounts: accounts.map(accountView) };
  },
  'transactions.listAll': async (_bb, scope, args) => {
    const amounts: (DecimalString | null)[] = [];
    let count = 0;
    let pages = 0;
    for await (const page of scope(args).accounts.transactionPages(s(args, 'accountId'), {
      limit: args.limit as number | undefined,
    })) {
      pages += 1;
      count += page.data.length;
      amounts.push(...page.data.map((t) => t.amount ?? null));
    }
    return { count, pages, amounts, sumAmount: sumAmounts(amounts) };
  },
};

function interpolateArgs(
  args: Record<string, unknown> | undefined,
  vars: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] =
      typeof v === 'string'
        ? v.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name: string) => {
            const resolved = vars[name];
            if (resolved === undefined) throw new UnresolvedVar(name);
            return resolved;
          })
        : v;
  }
  return out;
}

function extractPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const token of path.match(/[A-Za-z0-9_]+|\[\d+\]/g) ?? []) {
    if (current === null || typeof current !== 'object') return undefined;
    current = token.startsWith('[')
      ? (current as unknown[])[Number(token.slice(1, -1))]
      : (current as Record<string, unknown>)[token];
  }
  return current;
}

async function scenarioMode(): Promise<number> {
  const file = process.env.CT_SCENARIO_FILE;
  const baseUrl = process.env.CT_BASE_URL;
  const apiKey = process.env.CT_API_KEY;
  if (file === undefined || baseUrl === undefined || apiKey === undefined) {
    process.stderr.write('CT_SCENARIO_FILE, CT_BASE_URL and CT_API_KEY are required\n');
    return 1;
  }
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as {
    protocolVersion: number;
    name: string;
    vars?: Record<string, string>;
    driver: { config: DriverConfig; steps: Step[] };
  };
  if (fixture.protocolVersion !== 1) {
    process.stdout.write(JSON.stringify({ unsupported: `protocolVersion ${fixture.protocolVersion}` }));
    return 3;
  }
  const config = fixture.driver.config;
  const bb = new BudgetBakers({
    apiKey,
    baseUrl,
    retryBaseMs: config.retryBaseMs,
    maxRetries: config.maxRetries,
  });
  const vars: Record<string, string> = { ...fixture.vars };
  const scope = (args: Record<string, unknown>) => bb.client(s(args, 'clientId'));

  const steps: JournalStep[] = [];
  for (const step of fixture.driver.steps) {
    const fn = OPS[step.op];
    if (fn === undefined) {
      process.stdout.write(JSON.stringify({ unsupported: step.op }));
      return 3;
    }
    let entry: JournalStep;
    try {
      const args = interpolateArgs(step.args, vars);
      const ok = await fn(bb, scope, args, config);
      entry = { id: step.id, op: step.op, ok };
      for (const [name, path] of Object.entries(step.save ?? {})) {
        const extracted = extractPath(ok, path);
        if (extracted !== undefined && extracted !== null) vars[name] = String(extracted);
      }
    } catch (err) {
      if (err instanceof UnresolvedVar) {
        entry = { id: step.id, op: step.op, skipped: `unresolved var ${err.varName}` };
      } else if (err instanceof PartnerApiError) {
        entry = {
          id: step.id,
          op: step.op,
          error: { code: err.code, httpStatus: err.httpStatus, requestId: err.requestId },
        };
      } else {
        entry = { id: step.id, op: step.op, crash: err instanceof Error ? err.message : String(err) };
      }
    }
    steps.push(entry);
  }

  process.stdout.write(
    JSON.stringify({ protocolVersion: 1, driver: IDENTITY, scenario: fixture.name, steps }),
  );
  return 0;
}

function webhooksigMode(): number {
  const file = process.env.CT_FIXTURE_FILE;
  if (file === undefined) {
    process.stderr.write('CT_FIXTURE_FILE is required\n');
    return 1;
  }
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as {
    verifyVectors: { name: string; secrets: string[]; header: string; body: string; now: number }[];
  };
  const results = fixture.verifyVectors.map((v) => ({
    name: v.name,
    result: verify(v.secrets, v.header, Buffer.from(v.body, 'utf8'), v.now),
  }));
  process.stdout.write(
    JSON.stringify({ protocolVersion: 1, driver: IDENTITY, mode: 'webhooksig', results }),
  );
  return 0;
}

function eventsMode(): number {
  const file = process.env.CT_FIXTURE_FILE;
  if (file === undefined) {
    process.stderr.write('CT_FIXTURE_FILE is required\n');
    return 1;
  }
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as {
    vectors: { name: string; body: string }[];
  };
  const results = fixture.vectors.map((v) => {
    const parsed = parseEvent(v.body);
    if (parsed.kind === 'event') {
      return {
        name: v.name,
        kind: 'event',
        type: parsed.type,
        eventId: parsed.eventId,
        clientId: parsed.clientId,
        connectionId: parsed.connectionId,
        reasonCode: parsed.reason?.code ?? null,
        extra: parsed.extra,
      };
    }
    if (parsed.kind === 'unknown') return { name: v.name, kind: 'unknown', type: parsed.type };
    return { name: v.name, kind: 'parse_error' };
  });
  process.stdout.write(
    JSON.stringify({ protocolVersion: 1, driver: IDENTITY, mode: 'events', results }),
  );
  return 0;
}

async function main(): Promise<number> {
  const mode = process.argv[2];
  if (mode === 'probe') {
    process.stdout.write(JSON.stringify({ protocolVersion: 1, ...IDENTITY }));
    return 0;
  }
  if (mode === 'scenario') return scenarioMode();
  if (mode === 'webhooksig') return webhooksigMode();
  if (mode === 'events') return eventsMode();
  process.stdout.write(JSON.stringify({ unsupported: `mode ${String(mode)}` }));
  return 3;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  },
);
