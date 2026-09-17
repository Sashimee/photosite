import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap/configure-app.js';
import { createFastifyAdapter } from '../bootstrap/fastify-adapter.js';
import { APP_CONFIG, type Env } from '../config/env.js';
import { TestEmailWorkerModule } from './test-email-worker.module.js';

export async function createTestApp(env: Env): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, TestEmailWorkerModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(env)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(env.TRUSTED_PROXIES),
  );
  await configureApp(app, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
