import type { TranslateFn } from './auth-errors';

export interface ApiErrorLike {
  code?: string;
  message?: string;
  details?: unknown;
}

const ERROR_CODE_KEYS: Record<string, string> = {
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  VALIDATION_ERROR: 'invalid',
  UNPROCESSABLE_ENTITY: 'invalid',
  CONFLICT: 'conflict',
};

// Maps a generic ApiError (list fetches, the health check, ...) onto a
// translated message; auth-flow errors have their own enumeration in
// auth-errors.ts. `t` is scoped to the caller's own `errors.*` keys (e.g.
// `admin.dataTable.errors`); `fallback` is what an unmapped code or a
// codeless error (a thrown network failure) renders as, and is left to the
// caller so this module doesn't own a namespace of its own.
export function apiErrorMessage(
  t: TranslateFn,
  fallback: string,
  error: ApiErrorLike | undefined,
): string {
  if (!error?.code) {
    return fallback;
  }
  const key = ERROR_CODE_KEYS[error.code];
  return key ? t(`errors.${key}`) : fallback;
}
