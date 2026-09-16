import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';
import './auth.js';
import './profiles.js';
import './products.js';
import './requests.js';
import './quotes.js';
import './bookings.js';

export const OPENAPI_INFO_VERSION = '0.1.0';

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'photoo.lu API',
      version: OPENAPI_INFO_VERSION,
    },
    servers: [{ url: 'https://api.photoo.lu' }],
  });
}
