// The SDK surface (DESIGN.md §9.1): client-scoped ergonomics that hide the
// X-Client-Id header, cursor-pagination async iterators, automatic
// Idempotency-Key on creates (explicit override supported), and a
// connect-session polling helper.

import { randomUUID } from 'node:crypto';
import { Transport, type RequestOptions } from './transport';
import * as webhooks from './webhooks';
import type {
  Account,
  Client,
  Connection,
  ConnectionCreateResponse,
  ConnectSession,
  ConnectSessionCreateResponse,
  PartnerConfigResponse,
  Provider,
  ProviderPage,
  Page,
  RefreshAccepted,
  Transaction,
  TransactionPage,
} from './types';

export interface BudgetBakersOptions {
  /** Partner API key (bb_test_… / bb_live_…). Selects the sandbox/live mode. */
  apiKey: string;
  /** Cluster base URL; defaults to the acceptance cluster. */
  baseUrl?: string;
  /** Backoff base for 429/5xx retries; production default 500 ms. */
  retryBaseMs?: number;
  /** Retries after the initial attempt on 429/5xx. */
  maxRetries?: number;
  /** Injectable fetch (tests, instrumentation). */
  fetch?: typeof globalThis.fetch;
}

export const DEFAULT_BASE_URL = 'https://partner.test.bbapi.dev';

interface IdempotentOptions {
  /** Explicit Idempotency-Key; auto-generated UUID when omitted. */
  idempotencyKey?: string;
}

export interface WaitForTerminalOptions {
  /** Delay between session polls (default 2000 ms). */
  pollIntervalMs?: number;
  /** Give up after this many polls (default 150 ≈ 5 min at the default interval). */
  maxPolls?: number;
  /** Called with every polled session (progress UIs, conformance drivers). */
  onPoll?: (session: ConnectSession) => void;
  signal?: AbortSignal;
}

const TERMINAL_STATES: ReadonlySet<string> = new Set(['Completed', 'Failed', 'Cancelled', 'Expired']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function* iteratePages<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<Page<T>, void, undefined> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    yield page;
    if (page.nextCursor === null || page.nextCursor === undefined) return;
    cursor = page.nextCursor;
  }
}

async function* iterateItems<T>(
  pages: AsyncGenerator<Page<T>, void, undefined>,
): AsyncGenerator<T, void, undefined> {
  for await (const page of pages) yield* page.data;
}

export interface ListProvidersParams {
  country?: string;
  search?: string;
  limit?: number;
}

export interface ListTransactionsParams {
  limit?: number;
  /** Filter by variable symbols (≤20). */
  variableSymbol?: string[];
}

/** Everything scoped to one end user (X-Client-Id header). */
export class ClientScope {
  constructor(
    private readonly transport: Transport,
    readonly clientId: string,
  ) {}

  private request<T>(method: string, path: string, req: RequestOptions = {}): Promise<T> {
    return this.transport.request<T>(method, path, { ...req, clientId: this.clientId });
  }

  /** Delete this client and purge related data (DPA/SLA). */
  async delete(): Promise<void> {
    await this.request<void>('DELETE', `/v1/clients/${encodeURIComponent(this.clientId)}`);
  }

  readonly connections = {
    create: (params: { providerId: string } & IdempotentOptions): Promise<ConnectionCreateResponse> =>
      this.request('POST', '/v1/connections', {
        body: { providerId: params.providerId },
        idempotencyKey: params.idempotencyKey ?? randomUUID(),
      }),
    get: (connectionId: string): Promise<Connection> =>
      this.request('GET', `/v1/connections/${encodeURIComponent(connectionId)}`),
    delete: async (connectionId: string): Promise<void> => {
      await this.request<void>('DELETE', `/v1/connections/${encodeURIComponent(connectionId)}`);
    },
    refresh: (connectionId: string): Promise<RefreshAccepted> =>
      this.request('POST', `/v1/connections/${encodeURIComponent(connectionId)}/refresh`),
    reconnect: (
      connectionId: string,
      params: IdempotentOptions = {},
    ): Promise<ConnectionCreateResponse> =>
      this.request('POST', `/v1/connections/${encodeURIComponent(connectionId)}/reconnect`, {
        body: {},
        idempotencyKey: params.idempotencyKey ?? randomUUID(),
      }),
    /** Idempotent: revoking an already-Inactive connection is a no-op 200. */
    revoke: async (connectionId: string): Promise<void> => {
      await this.request<void>('PATCH', `/v1/connections/${encodeURIComponent(connectionId)}/revoke`);
    },
    /** Raw array, capped at 100 by the API (not paginated). */
    listAccounts: (connectionId: string): Promise<Account[]> =>
      this.request('GET', `/v1/connections/${encodeURIComponent(connectionId)}/accounts`),
  };

  readonly accounts = {
    /** Iterate every transaction across pages: `for await (const tx of …)`. */
    transactions: (accountId: string, params: ListTransactionsParams = {}) =>
      iterateItems(this.accounts.transactionPages(accountId, params)),
    /** Page-level iteration when you need cursors/limits. */
    transactionPages: (
      accountId: string,
      params: ListTransactionsParams = {},
    ): AsyncGenerator<TransactionPage, void, undefined> =>
      iteratePages<Transaction>((cursor) =>
        this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/transactions`, {
          query: {
            limit: params.limit,
            variableSymbol: params.variableSymbol && JSON.stringify(params.variableSymbol),
            nextCursor: cursor,
          },
        }),
      ),
  };

  readonly connectSessions = {
    /** Create a hosted connect session; hand `hostedUrl` to the Link SDK / browser.
     *  `connectionId` reconnects an existing connection instead of creating one
     *  (the bank picker is then skipped, so do not also pass `providerId`). */
    create: (
      params: { returnUrl: string; providerId?: string; connectionId?: string } & IdempotentOptions,
    ): Promise<ConnectSessionCreateResponse> => {
      const body: Record<string, unknown> = { returnUrl: params.returnUrl };
      if (params.providerId !== undefined) body.providerId = params.providerId;
      if (params.connectionId !== undefined) body.connectionId = params.connectionId;
      return this.request('POST', '/v1/connect-sessions', {
        body,
        idempotencyKey: params.idempotencyKey ?? randomUUID(),
      });
    },
    get: (sessionId: string): Promise<ConnectSession> =>
      this.request('GET', `/v1/connect-sessions/${encodeURIComponent(sessionId)}`),
    /** Poll until the session reaches a terminal state (or maxPolls). */
    waitForTerminal: async (
      sessionId: string,
      opts: WaitForTerminalOptions = {},
    ): Promise<ConnectSession> => {
      const interval = opts.pollIntervalMs ?? 2000;
      const maxPolls = opts.maxPolls ?? 150;
      let session: ConnectSession | null = null;
      for (let poll = 0; poll < maxPolls; poll += 1) {
        if (poll > 0) await sleep(interval);
        opts.signal?.throwIfAborted();
        session = await this.connectSessions.get(sessionId);
        opts.onPoll?.(session);
        if (TERMINAL_STATES.has(session.state)) return session;
      }
      if (session === null) throw new Error('waitForTerminal: maxPolls must be >= 1');
      return session;
    },
  };
}

export class BudgetBakers {
  private readonly transport: Transport;

  constructor(options: BudgetBakersOptions) {
    this.transport = new Transport({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
      retryBaseMs: options.retryBaseMs ?? 500,
      maxRetries: options.maxRetries ?? 3,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    });
  }

  /** Scope every client-bound call to one end user. */
  client(clientId: string): ClientScope {
    return new ClientScope(this.transport, clientId);
  }

  readonly clients = {
    /** Upserts by externalId: an existing externalId returns the existing client. */
    create: (params: {
      externalId?: string;
      email?: string;
      countryCode?: string;
      [key: string]: unknown;
    }): Promise<Client> => this.transport.request('POST', '/v1/clients', { body: params }),
    get: (clientId: string): Promise<Client> =>
      this.transport.request('GET', `/v1/clients/${encodeURIComponent(clientId)}`),
    getByExternalId: (externalId: string): Promise<Client> =>
      this.transport.request('GET', '/v1/clients', { query: { externalId } }),
  };

  readonly providers = {
    /** Iterate every provider across pages. */
    list: (params: ListProvidersParams = {}) => iterateItems(this.providers.pages(params)),
    pages: (params: ListProvidersParams = {}): AsyncGenerator<ProviderPage, void, undefined> =>
      iteratePages<Provider>((cursor) =>
        this.transport.request('GET', '/v1/providers', {
          query: {
            country: params.country,
            search: params.search,
            limit: params.limit,
            nextCursor: cursor,
          },
        }),
      ),
  };

  readonly partner = {
    /** Capability discovery — self-description of the calling partner + key mode. */
    getConfig: (): Promise<PartnerConfigResponse> =>
      this.transport.request('GET', '/v1/partner/config'),
  };

  /** Webhook helpers: `verify` (signature) and `parseEvent` (typed events). */
  readonly webhooks = webhooks;
}
