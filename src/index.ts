// @budgetbakers/partner-sdk - BudgetBakers Partner API server SDK.
// Follows the Partner API v2 reference; the connection lifecycle actions
// follow the v1.1 reference.

export { BudgetBakers, ClientScope, DEFAULT_BASE_URL } from './client';
export type {
  BudgetBakersOptions,
  ListAccountsParams,
  ListProvidersParams,
  ListTransactionsParams,
  WaitForTerminalOptions,
} from './client';

export { PartnerApiError, PartnerApiUnreachable } from './errors';
export type { ErrorCode } from './errors';

export {
  fromCents,
  isDecimalString,
  sumAmounts,
  toCents,
  toDecimalString,
} from './decimal';
export type { DecimalString } from './decimal';

export {
  parseEvent,
  sign,
  SIGNATURE_HEADER,
  TOLERANCE_SECONDS,
  verify,
} from './webhooks';
export type { VerifyResult } from './webhooks';

export type {
  Account,
  AccountPage,
  Client,
  ClientCreateRequest,
  ClientPage,
  Connection,
  ConnectionCreateResponse,
  ConnectionState,
  ConnectSession,
  ConnectSessionCreateResponse,
  ConnectSessionState,
  Enrichment,
  EnrichmentCategory,
  Merchant,
  Mode,
  Page,
  ParsedWebhook,
  PartnerCapabilities,
  PartnerConfigResponse,
  Provider,
  ProviderPage,
  RefreshAccepted,
  ResultCode,
  SubscriptionStatus,
  Transaction,
  TransactionDetails,
  TransactionPage,
  UnknownEvent,
  WebhookEvent,
  WebhookEventType,
  WebhookParseError,
  WebhookReason,
  WebhookReasonCode,
} from './types';
