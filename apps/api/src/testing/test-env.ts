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
  DEV_MAIL_WORKER: true,
  SMTP_HOST: 'localhost',
  SMTP_PORT: 1025,
  SMTP_FROM: 'dev@photoo.test',
};

export const UNREACHABLE_TEST_ENV: Env = {
  ...TEST_ENV,
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/photoo_test',
  REDIS_URL: 'redis://127.0.0.1:1',
};
