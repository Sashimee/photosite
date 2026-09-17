import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const BodySchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

describe('ZodValidationPipe', () => {
  it('returns the parsed value when it matches the schema', () => {
    const pipe = new ZodValidationPipe(BodySchema);
    expect(pipe.transform({ name: 'Jane' })).toEqual({ name: 'Jane' });
  });

  it('throws a ZodValidationException with a VALIDATION_ERROR payload on invalid input', () => {
    const pipe = new ZodValidationPipe(BodySchema);
    try {
      pipe.transform({ name: '' });
      expect.unreachable();
    } catch (error) {
      const response = (
        error as { getResponse: () => { code: string; message: string; details: unknown } }
      ).getResponse();
      expect(response.code).toBe('VALIDATION_ERROR');
      expect(response.message).toBe('Request validation failed');
      expect(response.details).toEqual([{ path: 'name', message: expect.any(String) as string }]);
    }
  });

  it('rejects unknown keys on a strict schema', () => {
    const pipe = new ZodValidationPipe(BodySchema);
    expect(() => pipe.transform({ name: 'Jane', extra: 'nope' })).toThrow();
  });
});
