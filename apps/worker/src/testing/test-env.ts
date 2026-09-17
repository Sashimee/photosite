import type { Env } from '../config/env.js';

export const TEST_ENV: Env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/photoo_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  HEALTH_PORT: 4101,
  CLAMAV_HOST: '127.0.0.1',
  CLAMAV_PORT: 3310,
  WORKER_CONCURRENCY_FILE_SCAN: 2,
  WORKER_CONCURRENCY_IMAGE_PROCESS: 2,
  WORKER_CONCURRENCY_UPLOADS_CLEANUP: 1,
};

export const UNREACHABLE_TEST_ENV: Env = {
  ...TEST_ENV,
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/photoo_test',
  REDIS_URL: 'redis://127.0.0.1:1',
};
