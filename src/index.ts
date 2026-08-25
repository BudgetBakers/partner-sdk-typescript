// @budgetbakers/partner-sdk — BudgetBakers Partner API server SDK (WP4.1).
// Spec: spec/partner-api-v1.1.yaml (single source of truth, D9).

export { BudgetBakers, ClientScope, DEFAULT_BASE_URL } from './client';
export type {
  BudgetBakersOptions,
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
  Client,
  Connection,
  ConnectionCreateResponse,
  ConnectionState,
  ConnectSession,
  ConnectSessionCreateResponse,
  ConnectSessionState,
  Mode,
  Page,
  ParsedWebhook,
  PartnerCapabilities,
  PartnerConfigResponse,
  Provider,
  ProviderPage,
  RefreshAccepted,
  ResultCode,
  Transaction,
  TransactionEnrichment,
  TransactionPage,
  UnknownEvent,
  WebhookEvent,
  WebhookEventType,
  WebhookParseError,
  WebhookReason,
  WebhookReasonCode,
} from './types';
