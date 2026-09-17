import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { APP_CONFIG, type Env } from '../config/env.js';

export async function createTestContext(env: Env): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(env)
    .compile();

  await moduleRef.init();
  return moduleRef;
}
