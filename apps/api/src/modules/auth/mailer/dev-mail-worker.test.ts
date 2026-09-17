import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_CONFIG, EnvModule } from '../../../config/env.js';
import { TEST_ENV } from '../../../testing/test-env.js';
import { DEV_MAIL_WORKER, EmailQueueModule } from './email-queue.module.js';
import { DevMailWorker } from './dev-mail-worker.js';

const NOOP_LOGGER = { error: () => undefined, warn: () => undefined } as unknown as Logger;

@Global()
@Module({ providers: [{ provide: Logger, useValue: NOOP_LOGGER }], exports: [Logger] })
class NoopLoggerModule {}

describe('DevMailWorker', () => {
  it('throws when constructed with NODE_ENV=production', () => {
    expect(() => new DevMailWorker({ ...TEST_ENV, NODE_ENV: 'production' }, NOOP_LOGGER)).toThrow(
      /production/,
    );
  });

  it('constructs without throwing outside production', () => {
    const worker = new DevMailWorker({ ...TEST_ENV, NODE_ENV: 'test' }, NOOP_LOGGER);
    return worker.onApplicationShutdown();
  });
});

describe('EmailQueueModule dev mail worker wiring', () => {
  it('never instantiates a worker when NODE_ENV=production', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NoopLoggerModule, EnvModule, EmailQueueModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...TEST_ENV, NODE_ENV: 'production' })
      .compile();

    const holder = moduleRef.get<{ worker: DevMailWorker | null }>(DEV_MAIL_WORKER);
    expect(holder.worker).toBeNull();
    await moduleRef.close();
  });

  it('does not instantiate a worker when DEV_MAIL_WORKER is not explicitly true', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NoopLoggerModule, EnvModule, EmailQueueModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...TEST_ENV, DEV_MAIL_WORKER: false })
      .compile();

    const holder = moduleRef.get<{ worker: DevMailWorker | null }>(DEV_MAIL_WORKER);
    expect(holder.worker).toBeNull();
    await moduleRef.close();
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
