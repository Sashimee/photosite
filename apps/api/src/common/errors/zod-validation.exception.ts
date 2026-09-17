import { HttpException, HttpStatus } from '@nestjs/common';
import type { ZodError } from 'zod';

export class ZodValidationException extends HttpException {
  constructor(error: ZodError) {
    super(
      {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
