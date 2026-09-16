import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

export const API_PREFIX = '/v1';

export function apiPath(path: string): string {
  return `${API_PREFIX}${path}`;
}

export const AUTH_SECURITY = [{ cookieAuth: [] }, { bearerAuth: [] }];

export const ADMIN_SECURITY = [{ cookieAuth: [] }];

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'photoo_session',
  description: 'Session cookie used by the web app',
});

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Bearer session token used by mobile apps',
});
