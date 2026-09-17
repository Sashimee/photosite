import type { Env } from '../config/env.js';

export const TEST_ENV: Env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/photoo_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  HEALTH_PORT: 4101,
  CLAMAV_HOST: '127.0.0.1',
  CLAMAV_PORT: 3310,
  CLAMAV_SCAN_TIMEOUT_MS: 30_000,
  CLAMAV_MAX_SCAN_BYTES: 25 * 1024 * 1024,
  WORKER_CONCURRENCY_FILE_SCAN: 2,
  WORKER_CONCURRENCY_IMAGE_PROCESS: 2,
  WORKER_CONCURRENCY_UPLOADS_CLEANUP: 1,
  UPLOADS_CLEANUP_INTERVAL_MS: 10 * 60 * 1000,
  IMAGE_PROCESS_MAX_PIXELS: 100_000_000,
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'eu-west-1',
  S3_ACCESS_KEY_ID: 'photoo_dev',
  S3_SECRET_ACCESS_KEY: 'photoo_dev_password',
  S3_FORCE_PATH_STYLE: true,
  S3_PRIVATE_BUCKET: 'photoo-private',
  S3_PUBLIC_BUCKET: 'photoo-public',
};

export const UNREACHABLE_TEST_ENV: Env = {
  ...TEST_ENV,
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/photoo_test',
  REDIS_URL: 'redis://127.0.0.1:1',
};
