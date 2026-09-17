import { toNodeHandler } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../../config/env.js';
import type { Auth } from './auth-instance.js';
import { isOAuthProvider, isProviderConfigured } from './oauth-providers.js';

const OAUTH_CALLBACK_PATH = '/v1/auth/callback/:provider';

// Issue #14: the previous `/v1/auth/*` wildcard forwarded every Better Auth
// route (list-sessions, get-session, update-user, sign-up/email, ...) to the
// library's own router, bypassing our contract validation, rate limiting and
// AuditLog. The only Better Auth HTTP route the product still needs is the
// OAuth provider callback (state/PKCE exchange, session creation, redirect),
// and only for a provider that is actually configured.
export function mountOAuthCallback(fastify: FastifyInstance, auth: Auth, config: Env): void {
  const nodeHandler = toNodeHandler(auth);
  fastify.route({
    method: ['GET', 'POST'],
    url: OAUTH_CALLBACK_PATH,
    handler: (request, reply) => {
      const provider = (request.params as { provider: string }).provider;
      if (!isOAuthProvider(provider) || !isProviderConfigured(provider, config)) {
        reply.status(404).send({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: `${provider} sign-in is not configured`,
          requestId: request.id,
        });
        return;
      }
      reply.hijack();
      return nodeHandler(request.raw, reply.raw);
    },
  });
}
