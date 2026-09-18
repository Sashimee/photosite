import { HttpException, HttpStatus } from '@nestjs/common';

export interface NormalizedException {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
  eventId?: string;
}

const DEFAULT_CODES_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

function codeForStatus(status: number): string {
  return DEFAULT_CODES_BY_STATUS[status] ?? 'ERROR';
}

interface StructuredExceptionBody {
  code: string;
  message: string;
  details?: unknown;
}

function isStructuredExceptionBody(value: unknown): value is StructuredExceptionBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

export function normalizeException(exception: unknown): NormalizedException {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (isStructuredExceptionBody(response)) {
      return { status, code: response.code, message: response.message, details: response.details };
    }

    if (typeof response === 'string') {
      return { status, code: codeForStatus(status), message: response };
    }

    const responseMessage = (response as { message?: unknown }).message;
    const message = typeof responseMessage === 'string' ? responseMessage : exception.message;
    return { status, code: codeForStatus(status), message };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error',
  };
}

export function buildApiErrorBody(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
  eventId?: string,
): ApiErrorBody {
  const body: ApiErrorBody = { code, message, requestId };
  if (details !== undefined) {
    body.details = details;
  }
  if (eventId !== undefined) {
    body.eventId = eventId;
  }
  return body;
}
