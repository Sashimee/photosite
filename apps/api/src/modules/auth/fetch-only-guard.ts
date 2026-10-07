import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { HttpException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site']);

// For GET routes with side effects (audit row, rate-limit budget) that
// OriginGuard lets through: a SameSite=Lax cookie still rides a top-level
// navigation from another site, so a browser request must be a fetch from
// our own site. Requests without Sec-Fetch headers (curl, old browsers) carry
// no ambient browser context and still face the permission and 2FA checks.
@Injectable()
export class FetchOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const mode = request.headers['sec-fetch-mode'];
    const site = request.headers['sec-fetch-site'];

    if (mode === 'navigate') {
      throw new HttpException(
        {
          code: 'FORBIDDEN',
          message: 'This endpoint cannot be opened as a page; download it from the admin app',
        },
        403,
      );
    }
    if (site !== undefined && (typeof site !== 'string' || !ALLOWED_FETCH_SITES.has(site))) {
      throw new HttpException(
        {
          code: 'FORBIDDEN',
          message: 'Cross-site request rejected; download it from the admin app',
        },
        403,
      );
    }
    return true;
  }
}
