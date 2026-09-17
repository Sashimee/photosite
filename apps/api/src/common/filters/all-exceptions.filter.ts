import { randomUUID } from 'node:crypto';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, Inject } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { buildApiErrorBody, normalizeException } from '../errors/api-error.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const requestId =
      typeof request.id === 'string' && request.id.length > 0 ? request.id : randomUUID();

    const normalized = normalizeException(exception);

    if (normalized.status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: request.url, method: request.method },
        normalized.message,
      );
    }

    reply
      .status(normalized.status)
      .send(buildApiErrorBody(normalized.code, normalized.message, requestId, normalized.details));
  }
}
