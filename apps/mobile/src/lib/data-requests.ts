import type { components } from '@photoo/api-client';

import { retryAfterSeconds, type ApiErrorLike } from './auth-errors';

export type DataRequest = components['schemas']['DataRequest'];

export type ExportState = 'none' | 'pending' | 'processing' | 'ready' | 'failed' | 'expired';

export function latestExport(requests: readonly DataRequest[]): DataRequest | null {
  return requests.find((request) => request.type === 'export') ?? null;
}

export function exportState(request: DataRequest | null, now: number): ExportState {
  if (!request) {
    return 'none';
  }
  switch (request.status) {
    case 'pending':
      return 'pending';
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'ready': {
      const expiresAt = request.expiresAt === null ? Number.NaN : Date.parse(request.expiresAt);
      return Number.isNaN(expiresAt) || expiresAt <= now ? 'expired' : 'ready';
    }
    default:
      return 'expired';
  }
}

const BLOCKING_REASON_KEYS: Record<string, string> = {
  VERIFICATION_IN_REVIEW: 'verificationInReview',
  ACCEPTED_QUOTE_WITHDRAWAL_WINDOW: 'acceptedQuoteWithdrawalWindow',
};

function blockingReason(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null || !('reason' in details)) {
    return undefined;
  }
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' ? BLOCKING_REASON_KEYS[reason] : undefined;
}

export type DataRequestErrorKey =
  | 'verificationInReview'
  | 'acceptedQuoteWithdrawalWindow'
  | 'conflict'
  | 'forbidden'
  | 'notFound'
  | 'gone'
  | 'invalid'
  | 'unauthorized'
  | 'tooManyRequests'
  | 'generic';

export function dataRequestError(error: ApiErrorLike | undefined): {
  key: DataRequestErrorKey;
  seconds?: number;
} {
  switch (error?.code) {
    case 'CONFLICT': {
      const reason = blockingReason(error.details);
      return { key: (reason as DataRequestErrorKey | undefined) ?? 'conflict' };
    }
    case 'TOO_MANY_REQUESTS': {
      const seconds = retryAfterSeconds(error.details);
      return seconds === undefined
        ? { key: 'tooManyRequests' }
        : { key: 'tooManyRequests', seconds };
    }
    case 'FORBIDDEN':
      return { key: 'forbidden' };
    case 'NOT_FOUND':
      return { key: 'notFound' };
    case 'GONE':
      return { key: 'gone' };
    case 'VALIDATION_ERROR':
    case 'UNPROCESSABLE_ENTITY':
      return { key: 'invalid' };
    case 'UNAUTHORIZED':
      return { key: 'unauthorized' };
    default:
      return { key: 'generic' };
  }
}

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

export function dataRequestErrorWithStatus(
  error: ApiErrorLike | undefined,
  status: number,
): ApiErrorLike {
  const code = error?.code ?? STATUS_CODES[status];
  return { ...error, ...(code ? { code } : {}) };
}
