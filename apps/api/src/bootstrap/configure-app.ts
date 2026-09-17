import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_PREFIX } from '@photoo/shared';
import { REQUEST_ID_HEADER } from '../common/constants.js';
import type { Env } from '../config/env.js';

const EXCLUDED_FROM_PREFIX = ['health', 'ready', 'openapi.json'];

export async function configureApp(app: NestFastifyApplication, config: Env): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook('onRequest', (request, reply, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  await app.register(helmet);
  await app.register(cors, { origin: config.WEB_ORIGINS, credentials: true });

  app.setGlobalPrefix(API_PREFIX, { exclude: EXCLUDED_FROM_PREFIX });
}
