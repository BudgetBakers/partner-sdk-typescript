# @budgetbakers/partner-sdk

Server SDK for the BudgetBakers Partner AISP API, for Node.js and TypeScript.
Zero runtime dependencies (native `fetch`, `node:crypto`); dual ESM+CJS with
types included; Node ≥ 20. Default base URL: `https://aisp-partner.bbapi.io`
(the API key selects sandbox vs live).

## Install

Until the package is on npm, download the tarball from the
[downloads page](https://aisp-docs.bbapi.io/guide/downloads) and install it
locally:

```sh
npm install ./budgetbakers-partner-sdk-<version>.tgz
```

Once published, the package name is `@budgetbakers/partner-sdk`; your code
does not change.

## Example

```ts
import { BudgetBakers } from '@budgetbakers/partner-sdk';

const bb = new BudgetBakers({ apiKey: process.env.BB_API_KEY! });

// Capability discovery (mode = sandbox|live, decided by the key).
const config = await bb.partner.getConfig();

// Clients upsert by externalId.
const client = await bb.clients.create({ externalId: 'user-42', email: 'u42@example.com', countryCode: 'CZ' });

// Client-scoped calls hide the X-Client-Id header.
const c = bb.client(client.id);

// Hosted connect flow: open hostedUrl in the user's browser, then poll.
const session = await c.connectSessions.create({ returnUrl: 'https://app.example.com/bb-callback' });
const done = await c.connectSessions.waitForTerminal(session.sessionId);

// Accounts: every page walked (Disabled, unselected accounts included).
const accounts = await c.connections.listAccounts(done.connectionId!);

// Cursor pagination as async iterators; filters and delta sync as params.
for await (const tx of c.accounts.transactions(accounts[0].id, { sinceSeq: 0 })) {
  // tx.amount is a DecimalString ("1234.56") - money is never a float.
}
```

## Webhook verification

```ts
// Constant-time verification against ALL active secrets (±300 s),
// typed events; unknown types pass through, never throw (respond 2xx).
const result = bb.webhooks.verify(secrets, req.headers['x-bb-signature'], rawBody);
const event = bb.webhooks.parseEvent(rawBody);
```

Verify over the raw request body bytes, before any JSON parsing.

## Behavior

- **Typed errors** - `PartnerApiError.code` is the stable machine code
  (`error.code`); branch on it, never on messages. `requestId` carries the
  `X-Request-Id` correlation id for support.
- **Retries** - exponential backoff + jitter on 429/5xx honoring
  `Retry-After`; POST retries only when an `Idempotency-Key` makes the replay
  safe (auto-generated UUID on creates, explicit `idempotencyKey` override).
- **Money** - amounts parsed losslessly from the wire into `DecimalString`s
  (branded); BigInt helpers `toCents`/`fromCents`/`sumAmounts`.
- **Nullability** - only `id` is guaranteed on Client/Connection/Account
  (plus `subscriptionStatus` on Account and `seq`/`createdSeq`/`recordDate`
  on Transaction); everything else is `| null`.
- **Paths** - reads and creates call `/v2` and unwrap the `{ data }`
  envelope; the connection lifecycle actions (`connections.create/delete/
  refresh/reconnect/revoke`) call `/v1`, where they live today.
  `clients.getByExternalId` resolves to `null` when nothing matches.

## Documentation

Guides and the API reference: <https://aisp-docs.bbapi.io>. Questions:
[integration@budgetbakers.com](mailto:integration@budgetbakers.com).

## Licence

Apache-2.0 (see `LICENSE` and `NOTICE`). Access to the Partner API itself is
governed by the BudgetBakers Partner Terms of Service.
