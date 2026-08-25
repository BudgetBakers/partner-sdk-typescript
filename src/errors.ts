// Error model (spec/partner-api-v1.1.yaml): every error response carries a
// stable machine-readable `error.code`. Branch on the code only — never parse
// `errorDesc` strings (they may change without notice).

/** Stable machine-readable error codes (spec `ErrorCode`). */
export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'capability_disabled'
  | 'operation_temporarily_unavailable'
  | 'connection_not_recoverable'
  | 'consent_inactive'
  | 'not_found'
  | 'refresh_in_progress'
  | 'refresh_cooldown'
  | 'refresh_quota_exceeded'
  | 'background_refresh_not_allowed'
  | 'rate_limited'
  | 'internal_error';

/** A typed partner API error (non-2xx with the v1.1 error envelope). */
export class PartnerApiError extends Error {
  constructor(
    /** Stable machine code — the only thing to branch on. */
    readonly code: ErrorCode,
    /** HTTP status of the response. */
    readonly httpStatus: number,
    /** Correlation id (X-Request-Id header / body requestId), for support. */
    readonly requestId: string | null,
    message: string,
    /** Present on refresh_cooldown / refresh_quota_exceeded. */
    readonly nextRefreshPossibleAt: string | null = null,
  ) {
    super(message);
    this.name = 'PartnerApiError';
  }
}

/** Network-level failure — the API endpoint was not reachable at all. */
export class PartnerApiUnreachable extends Error {
  constructor(readonly cause: unknown) {
    super('Partner API endpoint is not reachable');
    this.name = 'PartnerApiUnreachable';
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'validation_error',
  'unauthorized',
  'capability_disabled',
  'operation_temporarily_unavailable',
  'connection_not_recoverable',
  'consent_inactive',
  'not_found',
  'refresh_in_progress',
  'refresh_cooldown',
  'refresh_quota_exceeded',
  'background_refresh_not_allowed',
  'rate_limited',
  'internal_error',
]);

/** Fallbacks for gateway-shaped errors that lack the envelope (401/429 from Kong). */
function statusFallback(status: number): ErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'internal_error';
}

/** Build a typed error from a non-2xx response body + headers. */
export function parseErrorEnvelope(
  status: number,
  bodyText: string,
  headerRequestId: string | null,
): PartnerApiError {
  let code = statusFallback(status);
  let message = `HTTP ${status}`;
  let requestId = headerRequestId;
  let nextRefreshPossibleAt: string | null = null;
  try {
    const body = JSON.parse(bodyText) as {
      error?: { code?: string; message?: string; nextRefreshPossibleAt?: string };
      requestId?: string;
    };
    if (typeof body.error?.code === 'string' && KNOWN_CODES.has(body.error.code)) {
      code = body.error.code as ErrorCode;
    }
    if (typeof body.error?.message === 'string') message = body.error.message;
    if (requestId === null && typeof body.requestId === 'string') requestId = body.requestId;
    if (typeof body.error?.nextRefreshPossibleAt === 'string') {
      nextRefreshPossibleAt = body.error.nextRefreshPossibleAt;
    }
  } catch {
    // Non-JSON error body (gateway) — keep the status-derived fallback.
  }
  return new PartnerApiError(code, status, requestId, message, nextRefreshPossibleAt);
}
