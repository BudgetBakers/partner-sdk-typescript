// API models, hand-written from the Partner API v2 reference. The connection
// lifecycle actions (create, refresh, reconnect, revoke, delete) keep their
// v1.1 shapes. Only `id` is guaranteed non-null on Client / Connection /
// Account / Transaction unless the spec marks a field required; SDKs must not
// assume presence. Amounts are DecimalString (never float).

import type { DecimalString } from './decimal';

/** Partner API mode — selected by the API key (bb_test_… / bb_live_…). */
export type Mode = 'sandbox' | 'live';

export interface Provider {
  id: string;
  name: string;
  code?: string | null;
  countryCode?: string | null;
  logoUrl?: string | null;
  bicCodes?: string[] | null;
  /** Effective visibility for this partner, composed from every status layer the platform applies. */
  status?: 'Active' | 'Inactive' | 'Hidden' | 'Disabled' | null;
  mode?: 'Api' | 'Web' | null;
  timeZone?: string | null;
}

export interface Page<T> {
  limit: number;
  /** Opaque keyset cursor; iterate until null. Send it with the same sort/filter parameters it was issued with. */
  nextCursor: string | null;
  data: T[];
}

export type ProviderPage = Page<Provider>;

export interface Client {
  id: string;
  externalId?: string | null;
  email?: string | null;
  countryCode?: string | null;
}

export interface ClientCreateRequest {
  email: string;
  countryCode: string;
  /** Your own user id. Re-posting an existing externalId returns the existing client (upsert). */
  externalId?: string;
}

export type ClientPage = Page<Client>;

export type ConnectionState = 'Pending' | 'Active' | 'Inactive' | 'Disabled';

export interface Connection {
  id: string;
  state?: ConnectionState | null;
  providerId?: string | null;
  consentExpiresAt?: string | null;
}

export interface ConnectionCreateResponse {
  connectionId: string;
  redirectUrl: string;
  expiresAt: string;
}

export interface RefreshAccepted {
  status: 'Accepted';
  nextRefreshPossibleAt?: string | null;
}

export type ConnectSessionState =
  | 'AwaitingBankSelection'
  | 'RedirectedToBank'
  | 'Fetching'
  | 'AwaitingAccountSelection'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'
  | 'Expired';

export type ResultCode = 'Ok' | 'Error' | 'Cancelled';

export interface ConnectSession {
  sessionId: string;
  state: ConnectSessionState;
  connectionId?: string | null;
  resultCode?: ResultCode | null;
  error?: string | null;
}

export interface ConnectSessionCreateResponse {
  /** Opaque — never parse. */
  sessionId: string;
  /** Opaque hosted-flow URL; open it in the user's browser as-is. */
  hostedUrl: string;
  expiresAt: string;
}

/** `Active` accounts receive transactions; `Disabled` ones were left unselected in the account picker. */
export type SubscriptionStatus = 'Active' | 'Unsubscribed' | 'Inactive' | 'Disabled';

export interface Account {
  id: string;
  name?: string | null;
  type?: string | null;
  balance?: DecimalString | null;
  currencyCode?: string | null;
  iban?: string | null;
  subscriptionStatus: SubscriptionStatus;
}

export type AccountPage = Page<Account>;

export interface EnrichmentCategory {
  categoryId: number;
  categoryName?: string | null;
  subcategoryId?: number | null;
  subcategoryName?: string | null;
}

export interface Merchant {
  id?: string;
  name?: string;
  logoUri?: string | null;
}

/** Null when enrichment is disabled for the partner. */
export interface Enrichment {
  category?: EnrichmentCategory | null;
  merchant?: Merchant | null;
  recurrent: boolean;
}

export interface TransactionDetails {
  variableSymbol?: string | null;
  constantSymbol?: string | null;
  specificSymbol?: string | null;
  transactionCode?: string | null;
  creditorReference?: string | null;
  externalCategoryName?: string | null;
  mccCode?: string | null;
  others?: Record<string, unknown> | null;
}

export interface Transaction {
  id: string;
  /** Change sequence for `sinceSeq` delta sync; re-issued on every server-side modification. */
  seq: number;
  /** Insert-order sequence for the `sinceCreatedSeq` create-only feed; never changes. */
  createdSeq: number;
  amount?: DecimalString | null;
  currencyCode?: string | null;
  recordState?: 'Cleared' | 'Uncleared' | null;
  recordDate: string;
  note?: string | null;
  counterParty?: string | null;
  enrichment?: Enrichment | null;
  details?: TransactionDetails | null;
}

export type TransactionPage = Page<Transaction>;

export interface PartnerCapabilities {
  refresh: boolean;
  reconnect: boolean;
  enrichment: boolean;
  autoRevokeAfterCreate: boolean;
  nonRegulatedProviders: boolean;
}

export interface PartnerConfigResponse {
  partnerId: string;
  name: string;
  mode: Mode;
  capabilities: PartnerCapabilities;
  consentDuration?: string | null;
  countries?: string[] | null;
  webhook: { signatureVersion: 'v1' };
}

// ---- Webhooks (spec/webhooks-v2.yaml) ---------------------------------------

export type WebhookEventType =
  | 'AuthenticationStarted'
  | 'AuthenticationSuccess'
  | 'AuthenticationFailed'
  | 'AuthenticationCanceled'
  | 'AccountsFetchingStarted'
  | 'AccountsFetchingSuccess'
  | 'AccountsFetchingFailed'
  | 'TransactionsFetchingStarted'
  | 'TransactionsFetchingSuccess'
  | 'TransactionsFetchingFailed'
  | 'ConnectionCreateSuccess'
  | 'ConnectionCreateFailed'
  | 'ConnectionReconnectSuccess'
  | 'ConnectionReconnectFailed'
  | 'ConnectionRefreshSuccess'
  | 'ConnectionRefreshFailed'
  | 'ConnectionDeleted'
  | 'ConnectionConsentRevoked'
  | 'ConnectionConsentExpired';

export type WebhookReasonCode =
  | 'consent_expired'
  | 'consent_revoked'
  | 'authentication_failed'
  | 'authentication_canceled'
  | 'authentication_timeout'
  | 'background_refresh_not_allowed'
  | 'provider_error'
  | 'internal_error';

export interface WebhookReason {
  code: WebhookReasonCode;
  message?: string | null;
}

/** A known lifecycle event; extra top-level fields pass through (additionalProperties). */
export interface WebhookEvent {
  kind: 'event';
  type: WebhookEventType;
  eventId: string;
  clientId: string;
  connectionId: string;
  createdAt: string;
  reason: WebhookReason | null;
  /** Any additional top-level fields (e.g. remainingDays). */
  extra: Record<string, unknown>;
}

/** An event type this SDK version does not know - process 2xx and ignore. */
export interface UnknownEvent {
  kind: 'unknown';
  type: string;
  raw: Record<string, unknown>;
}

/** The delivery body was not valid JSON — respond 4xx/alert, never crash. */
export interface WebhookParseError {
  kind: 'parse_error';
  message: string;
}

export type ParsedWebhook = WebhookEvent | UnknownEvent | WebhookParseError;
