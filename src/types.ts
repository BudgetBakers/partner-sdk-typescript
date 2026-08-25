// API models, hand-written from spec/partner-api-v1.1.yaml (the single source
// of truth; D9). Only `id` is guaranteed non-null on Client / Connection /
// Account / Transaction — every other field is nullable and SDKs must not
// assume presence. Amounts are DecimalString (never float).

import type { DecimalString } from './decimal';

/** Partner API mode — selected by the API key (bb_test_… / bb_live_…). */
export type Mode = 'sandbox' | 'live';

export interface Provider {
  id: string;
  name?: string | null;
  countryCode?: string | null;
  logoUrl?: string | null;
  bicCodes?: string[] | null;
  timeZone?: string | null;
  status?: 'Active' | 'Inactive' | 'Hidden' | 'Disabled' | null;
  code?: string | null;
}

export interface Page<T> {
  limit: number;
  /** Opaque; iterate until null. Offset-based today — not stable across concurrent inserts. */
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

export type ConnectionState = 'Pending' | 'Active' | 'Inactive' | 'Disabled';

export interface Connection {
  id: string;
  state?: ConnectionState | null;
  providerId?: string | null;
  errorDesc?: string | null;
  createdAt?: string | null;
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
  /** Opaque hosted-flow URL — hand to the Link SDK / browser as-is. */
  hostedUrl: string;
  expiresAt: string;
}

export interface Account {
  id: string;
  name?: string | null;
  type?: string | null;
  balance?: DecimalString | null;
  currencyCode?: string | null;
  iban?: string | null;
}

export interface TransactionEnrichment {
  category?: string | null;
  merchantName?: string | null;
  [key: string]: unknown;
}

export interface Transaction {
  id: string;
  amount?: DecimalString | null;
  currencyCode?: string | null;
  recordState?: 'Cleared' | 'Uncleared' | null;
  bookingDate?: string | null;
  description?: string | null;
  variableSymbol?: string | null;
  enrichment?: TransactionEnrichment | null;
  [key: string]: unknown;
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

/** An event type this SDK version does not know — process 2xx and ignore (D11). */
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
