import type { Env } from '../config/env.js';

export const TEST_ENV: Env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/photoo_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  PORT: 4000,
  PUBLIC_API_URL: 'http://localhost:4000',
  WEB_ORIGINS: ['http://localhost:3000'],
  WEB_APP_URL: 'http://localhost:3000',
  TRUSTED_PROXIES: [],
  AUTH_SECRET: 'test-auth-secret-at-least-32-characters-long',
  AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 9),
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'eu-west-1',
  S3_ACCESS_KEY_ID: 'photoo_dev',
  S3_SECRET_ACCESS_KEY: 'photoo_dev_password',
  S3_FORCE_PATH_STYLE: true,
  S3_PRIVATE_BUCKET: 'photoo-private',
  S3_PUBLIC_BUCKET: 'photoo-public',
  S3_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/photoo-public',
};

export const UNREACHABLE_TEST_ENV: Env = {
  ...TEST_ENV,
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/photoo_test',
  REDIS_URL: 'redis://127.0.0.1:1',
};
