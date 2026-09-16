import { SUPPORTED_LOCALES } from '../locale.js';
import { z } from './zod.js';

export const IdSchema = z
  .uuid()
  .openapi({ description: 'UUID identifier', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });

export const IsoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .openapi({ description: 'ISO 8601 date-time', example: '2026-09-16T12:00:00.000Z' });

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be a 3-letter uppercase ISO 4217 currency code')
  .openapi({ description: 'ISO 4217 currency code', example: 'EUR' });

export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'must be a 2-letter uppercase ISO 3166-1 country code')
  .openapi({ description: 'ISO 3166-1 alpha-2 country code', example: 'LU' });

export const MoneySchema = z
  .object({
    amountCents: z.int().nonnegative().openapi({ example: 15000 }),
    currency: CurrencyCodeSchema,
  })
  .strict()
  .openapi('Money');

export const LocaleSchema = z
  .enum(SUPPORTED_LOCALES)
  .openapi({ description: 'BCP 47 locale', example: 'en' });

export const CursorPaginationQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export function paginatedResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: z.string().min(1).nullable(),
    })
    .strict();
}

export const ApiErrorSchema = z
  .object({
    code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
    message: z.string().openapi({ example: 'Request validation failed' }),
    details: z.unknown().optional(),
    requestId: IdSchema,
  })
  .strict()
  .openapi('ApiError');

export const STANDARD_ERROR_STATUS_CODES = [400, 401, 403, 404, 409, 422, 429] as const;

export type StandardErrorStatusCode = (typeof STANDARD_ERROR_STATUS_CODES)[number];

const ERROR_STATUS_DESCRIPTIONS: Record<StandardErrorStatusCode, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  422: 'Unprocessable entity',
  429: 'Too many requests',
};

export function errorResponses(codes: readonly StandardErrorStatusCode[]) {
  return Object.fromEntries(
    codes.map((code) => [
      String(code),
      {
        description: ERROR_STATUS_DESCRIPTIONS[code],
        content: {
          'application/json': {
            schema: ApiErrorSchema,
          },
        },
      },
    ]),
  );
}
