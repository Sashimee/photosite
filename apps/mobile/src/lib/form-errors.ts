import type { ZodError } from 'zod';

const ISSUE_CODE_KEYS: Record<string, string> = {
  invalid_type: 'required',
  too_small: 'tooShort',
  too_big: 'tooLong',
  invalid_format: 'invalidFormat',
  custom: 'invalid',
};

export type ValidationTranslateFn = (key: string) => string;

// Never renders a zod issue's own `.message` (hard-coded English in
// packages/shared); translates by issue code instead so every string shown
// to the user comes from packages/i18n. `t` is expected to be scoped to
// `common.validation`. Keyed by the dot-joined field path ('' for root).
export function fieldErrorMessages(
  t: ValidationTranslateFn,
  error: ZodError | undefined,
): Record<string, string> {
  const messages: Record<string, string> = {};
  if (!error) {
    return messages;
  }

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (path in messages) {
      continue;
    }
    const key = ISSUE_CODE_KEYS[issue.code] ?? 'invalid';
    messages[path] = t(key);
  }

  return messages;
}
