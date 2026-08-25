# @budgetbakers/partner-sdk

BudgetBakers Partner API server SDK (TypeScript, WP4.1). Spec:
`spec/partner-api-v1.1.yaml` (single source of truth, D9). Zero runtime
dependencies (native `fetch`, `node:crypto`); dual ESM+CJS; Node ≥ 20.

```ts
import { BudgetBakers } from '@budgetbakers/partner-sdk';

const bb = new BudgetBakers({ apiKey: process.env.BB_API_KEY! });

// Capability discovery (mode = sandbox|live, decided by the key).
const config = await bb.partner.getConfig();

// Clients upsert by externalId.
const client = await bb.clients.create({ externalId: 'user-42' });

// Client-scoped calls hide the X-Client-Id header.
const c = bb.client(client.id);

// Hosted connect flow: hand hostedUrl to the browser / Link SDK, then poll.
const session = await c.connectSessions.create({ returnUrl: 'https://app.example.com/bb-callback' });
const done = await c.connectSessions.waitForTerminal(session.sessionId);

// Cursor pagination as async iterators.
for await (const tx of c.accounts.transactions(accountId)) {
  // tx.amount is a DecimalString ("1234.56") — money is never a float.
}

// Webhooks: constant-time verification against ALL active secrets (±300 s),
// typed events; unknown types pass through, never throw (respond 2xx).
const result = bb.webhooks.verify(secrets, req.headers['x-bb-signature'], rawBody);
const event = bb.webhooks.parseEvent(rawBody);
```

Behavior guarantees (DESIGN.md §9.1):

- **Typed errors** — `PartnerApiError.code` is the stable machine code
  (`error.code`); never parse `errorDesc`. `requestId` carries the
  `X-Request-Id` correlation id for support.
- **Retries** — exponential backoff + jitter on 429/5xx honoring
  `Retry-After`; POST retries only when an `Idempotency-Key` makes the replay
  safe (auto-generated UUID on creates, explicit `idempotencyKey` override).
- **Money** — amounts parsed losslessly from the wire into 2-dp
  `DecimalString`s (branded); BigInt helpers `toCents`/`fromCents`/`sumAmounts`.
- **Nullability** — only `id` is guaranteed on Client/Connection/Account/
  Transaction; everything else is `| null`.

## Development

```sh
make build   # tsup → dist/ (ESM+CJS+d.ts) + the conformance driver
make test    # vitest units + webhooksig/events vectors from contract-tests
make lint    # eslint + tsc --noEmit
```

Release gate: `make contract-matrix` at the repo root — this SDK's conformance
driver (`dist/conformance/cli.js`, `contract-tests/PROTOCOL.md`) must pass all
9 sandbox scenarios. Publishing to npm is a manual handoff (`private: true`
until then).
