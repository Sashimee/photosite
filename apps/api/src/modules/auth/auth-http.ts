import { HttpException } from '@nestjs/common';
import { APIError } from 'better-auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

const GENERIC_SERVER_ERROR_MESSAGE = 'Internal server error';

function messageForStatus(status: number, message: string): string {
  return status >= 500 ? GENERIC_SERVER_ERROR_MESSAGE : message;
}

function codeForStatus(status: number, code: string): string {
  return status >= 500 ? 'INTERNAL_SERVER_ERROR' : code;
}

export function toFetchHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

// Better Auth's endpoints called with `asResponse: true` never throw: every
// outcome, including a thrown APIError, is turned into a Response with the
// matching status. Error responses must therefore be detected here and
// converted into an HttpException instead of being parsed as success bodies.
export async function applyFetchResponse<T>(response: Response, reply: FastifyReply): Promise<T> {
  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (setCookies.length > 0) {
    reply.raw.setHeader('set-cookie', setCookies);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { code?: string; message?: string } | undefined;
    throw new HttpException(
      {
        code: codeForStatus(response.status, body?.code ?? 'AUTH_ERROR'),
        message: messageForStatus(response.status, body?.message ?? response.statusText),
      },
      response.status,
    );
  }

  reply.status(response.status);
  if (response.status === 204 || response.status === 304) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function rethrowAsHttpException(error: unknown): never {
  if (error instanceof APIError) {
    const body = error.body as { code?: string; message?: string } | undefined;
    throw new HttpException(
      {
        code: codeForStatus(error.statusCode, body?.code ?? 'AUTH_ERROR'),
        message: messageForStatus(error.statusCode, body?.message ?? error.message),
      },
      error.statusCode,
    );
  }
  throw error;
}
