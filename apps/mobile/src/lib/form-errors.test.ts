import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import { fieldErrorMessages, type ValidationTranslateFn } from './form-errors';

const t: ValidationTranslateFn = (key) => `common.validation.${key}`;

describe('fieldErrorMessages', () => {
  it('returns no messages when there is no error', () => {
    expect(fieldErrorMessages(t, undefined)).toEqual({});
  });

  it('maps each issue to its field path using the first issue per field', () => {
    const schema = z.object({
      email: z.email(),
      password: z.string().min(10).max(256),
    });
    const result = schema.safeParse({ email: 'nope', password: 'short' });

    expect(fieldErrorMessages(t, result.error)).toEqual({
      email: 'common.validation.invalidFormat',
      password: 'common.validation.tooShort',
    });
  });

  it('maps too_big to tooLong', () => {
    const schema = z.object({ password: z.string().max(5) });
    const result = schema.safeParse({ password: 'way too long' });

    expect(fieldErrorMessages(t, result.error)).toEqual({
      password: 'common.validation.tooLong',
    });
  });

  it('maps a custom refinement to invalid', () => {
    const schema = z
      .object({ roles: z.array(z.string()) })
      .refine((value) => value.roles.length > 0, 'roles must not be empty');
    const result = schema.safeParse({ roles: [] });

    expect(fieldErrorMessages(t, result.error)).toEqual({
      '': 'common.validation.invalid',
    });
  });
});
