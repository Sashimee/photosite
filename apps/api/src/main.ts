import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { createFastifyAdapter } from './bootstrap/fastify-adapter.js';
import { APP_CONFIG, loadEnv, type Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const bootstrapConfig = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(bootstrapConfig.TRUSTED_PROXIES),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  const config = app.get<Env>(APP_CONFIG);

  await configureApp(app, config);

  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
