import type { PipeTransform } from '@nestjs/common';
import type { z, ZodType } from 'zod';
import { ZodValidationException } from '../errors/zod-validation.exception.js';

export class ZodValidationPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ZodValidationException(result.error);
    }
    return result.data;
  }
}
