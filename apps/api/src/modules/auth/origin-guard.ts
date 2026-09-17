import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, type Env } from '../../config/env.js';

const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];

// D21 (docs/DECISIONS.md): CSRF defence for cookie-authenticated requests is
// an Origin allow-list check plus SameSite=Lax plus JSON-only bodies,
// instead of a double-submit token. GET is exempt (no state change);
// bearer-only requests (no cookie) are exempt (no ambient credential to ride).
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const contentType = request.headers['content-type'] ?? '';
    if (FORM_CONTENT_TYPES.some((type) => contentType.toLowerCase().startsWith(type))) {
      throw new HttpException(
        { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Only application/json bodies are accepted' },
        415,
      );
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      return true;
    }

    if (!request.headers.cookie) {
      return true;
    }

    const secFetchSite = request.headers['sec-fetch-site'];
    if (secFetchSite === 'cross-site') {
      throw new HttpException({ code: 'FORBIDDEN', message: 'Cross-site request rejected' }, 403);
    }

    const origin = request.headers.origin ?? refererOrigin(request.headers.referer);
    if (!origin || !this.config.WEB_ORIGINS.includes(origin)) {
      throw new HttpException({ code: 'FORBIDDEN', message: 'Cross-origin request rejected' }, 403);
    }

    return true;
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) {
    return undefined;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
