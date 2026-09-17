import type { TranslateFn } from './auth-errors';

const ISSUE_TYPE_KEYS: Record<string, string> = {
  invalid_type: 'required',
  too_small: 'tooShort',
  too_big: 'tooLong',
  invalid_format: 'invalidFormat',
  custom: 'invalid',
};

export interface FieldErrorLike {
  type?: string;
  message?: string;
}

// Never renders a zod issue's own `.message` (hard-coded English in
// packages/shared); translates by issue type instead so every string shown
// to the user comes from packages/i18n.
export function fieldErrorMessage(
  t: TranslateFn,
  error: FieldErrorLike | undefined,
): string | undefined {
  if (!error) {
    return undefined;
  }
  const key = (error.type ? ISSUE_TYPE_KEYS[error.type] : undefined) ?? 'invalid';
  return t(`validation.${key}`);
}
