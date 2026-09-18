import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/photoo',
  REDIS_URL: 'redis://127.0.0.1:6379',
  PORT: '4000',
  PUBLIC_API_URL: 'http://localhost:4000',
  WEB_ORIGINS: 'http://localhost:3000',
  WEB_APP_URL: 'http://localhost:3000',
  AUTH_SECRET: 'a'.repeat(32),
  AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  VERIFICATION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'eu-west-1',
  S3_ACCESS_KEY_ID: 'photoo_dev',
  S3_SECRET_ACCESS_KEY: 'photoo_dev_password',
  S3_FORCE_PATH_STYLE: 'true',
  S3_PRIVATE_BUCKET: 'photoo-private',
  S3_PUBLIC_BUCKET: 'photoo-public',
  S3_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/photoo-public',
};

describe('loadEnv', () => {
  it('parses a well-formed environment', () => {
    const env = loadEnv(validEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.REDIS_URL).toBe(validEnv.REDIS_URL);
    expect(env.PORT).toBe(4000);
    expect(env.PUBLIC_API_URL).toBe(validEnv.PUBLIC_API_URL);
    expect(env.WEB_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.NODE_ENV).toBe('development');
    expect(env.AUTH_ENCRYPTION_KEY).toBeInstanceOf(Buffer);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.TRUSTED_PROXIES).toEqual([]);
  });

  it('rejects a missing NODE_ENV', () => {
    const withoutNodeEnv: Record<string, string> = { ...validEnv };
    delete withoutNodeEnv.NODE_ENV;
    expect(() => loadEnv(withoutNodeEnv)).toThrow(/NODE_ENV/);
  });

  it('parses a comma-separated TRUSTED_PROXIES', () => {
    const env = loadEnv({
      ...validEnv,
      TRUSTED_PROXIES: '10.0.0.0/24, 192.168.1.1',
    });
    expect(env.TRUSTED_PROXIES).toEqual(['10.0.0.0/24', '192.168.1.1']);
  });

  it('refuses the .env.example AUTH_SECRET placeholder in production', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        AUTH_SECRET: 'dev-only-auth-secret-change-me-please-32-chars-min',
      }),
    ).toThrow(/AUTH_SECRET/);
  });

  it('refuses the .env.example AUTH_ENCRYPTION_KEY placeholder in production', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        AUTH_SECRET: 'b'.repeat(32),
        AUTH_ENCRYPTION_KEY: 'qA5jxlkWykGDbMKLOSqgSGG+lbzsuDkUWUS8nV9twig=',
      }),
    ).toThrow(/AUTH_ENCRYPTION_KEY/);
  });

  it('accepts the example values outside production', () => {
    const env = loadEnv({
      ...validEnv,
      NODE_ENV: 'development',
      AUTH_SECRET: 'dev-only-auth-secret-change-me-please-32-chars-min',
    });
    expect(env.AUTH_SECRET).toBe('dev-only-auth-secret-change-me-please-32-chars-min');
  });

  it('rejects a non-https WEB_APP_URL in production (S2)', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        AUTH_SECRET: 'b'.repeat(32),
        AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        WEB_APP_URL: 'http://photoo.lu',
      }),
    ).toThrow(/WEB_APP_URL/);
  });

  it('accepts an https WEB_APP_URL in production', () => {
    const env = loadEnv({
      ...validEnv,
      NODE_ENV: 'production',
      AUTH_SECRET: 'b'.repeat(32),
      AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      WEB_APP_URL: 'https://photoo.lu',
    });
    expect(env.WEB_APP_URL).toBe('https://photoo.lu');
  });

  it('splits and trims a comma-separated WEB_ORIGINS', () => {
    const env = loadEnv({
      ...validEnv,
      WEB_ORIGINS: ' http://localhost:3000 , https://photoo.lu ',
    });
    expect(env.WEB_ORIGINS).toEqual(['http://localhost:3000', 'https://photoo.lu']);
  });

  it('refuses to start and names the missing variable', () => {
    const withoutDatabaseUrl = {
      REDIS_URL: validEnv.REDIS_URL,
      PORT: validEnv.PORT,
      PUBLIC_API_URL: validEnv.PUBLIC_API_URL,
      WEB_ORIGINS: validEnv.WEB_ORIGINS,
    };
    expect(() => loadEnv(withoutDatabaseUrl)).toThrow(/DATABASE_URL/);
  });

  it('names an invalid variable rather than a generic message', () => {
    expect(() => loadEnv({ ...validEnv, PUBLIC_API_URL: 'not-a-url' })).toThrow(/PUBLIC_API_URL/);
  });

  it('rejects a PORT that is not a positive integer', () => {
    expect(() => loadEnv({ ...validEnv, PORT: '-1' })).toThrow(/PORT/);
  });

  it('rejects an empty WEB_ORIGINS', () => {
    expect(() => loadEnv({ ...validEnv, WEB_ORIGINS: '  ' })).toThrow(/WEB_ORIGINS/);
  });

  it('rejects a WEB_ORIGINS entry that is not a valid URL', () => {
    expect(() => loadEnv({ ...validEnv, WEB_ORIGINS: 'not-a-url' })).toThrow(/WEB_ORIGINS/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a missing AUTH_SECRET', () => {
    const withoutSecret: Record<string, string> = { ...validEnv };
    delete withoutSecret.AUTH_SECRET;
    expect(() => loadEnv(withoutSecret)).toThrow(/AUTH_SECRET/);
  });

  it('rejects an AUTH_SECRET shorter than 32 characters', () => {
    expect(() => loadEnv({ ...validEnv, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('rejects an AUTH_ENCRYPTION_KEY that is not 32 bytes', () => {
    expect(() =>
      loadEnv({ ...validEnv, AUTH_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/AUTH_ENCRYPTION_KEY/);
  });

  it('rejects a VERIFICATION_ENCRYPTION_KEY that is not 32 bytes', () => {
    expect(() =>
      loadEnv({ ...validEnv, VERIFICATION_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/VERIFICATION_ENCRYPTION_KEY/);
  });

  it('refuses the .env.example VERIFICATION_ENCRYPTION_KEY placeholder in production', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        AUTH_SECRET: 'b'.repeat(32),
        AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        VERIFICATION_ENCRYPTION_KEY: '9DsORuh9HI1DUnXKM0DKVcgw36Y9NfbLBSlfPmQxwYs=',
      }),
    ).toThrow(/VERIFICATION_ENCRYPTION_KEY/);
  });

  it('leaves OAuth provider credentials unset when not provided', () => {
    const env = loadEnv(validEnv);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it('treats an empty-string OAuth credential (as .env files set unfilled keys) as unset', () => {
    const env = loadEnv({
      ...validEnv,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it('accepts a non-empty OAuth credential pair', () => {
    const env = loadEnv({
      ...validEnv,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });
    expect(env.GOOGLE_CLIENT_ID).toBe('client-id');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('client-secret');
  });

  it('parses the S3 configuration, coercing S3_FORCE_PATH_STYLE to a boolean', () => {
    const env = loadEnv(validEnv);
    expect(env.S3_ENDPOINT).toBe('http://127.0.0.1:9000');
    expect(env.S3_REGION).toBe('eu-west-1');
    expect(env.S3_ACCESS_KEY_ID).toBe('photoo_dev');
    expect(env.S3_SECRET_ACCESS_KEY).toBe('photoo_dev_password');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.S3_PRIVATE_BUCKET).toBe('photoo-private');
    expect(env.S3_PUBLIC_BUCKET).toBe('photoo-public');
    expect(env.S3_PUBLIC_BASE_URL).toBe('http://127.0.0.1:9000/photoo-public');
  });

  it('defaults S3_FORCE_PATH_STYLE to false when unset', () => {
    const withoutFlag: Record<string, string> = { ...validEnv };
    delete withoutFlag.S3_FORCE_PATH_STYLE;
    expect(loadEnv(withoutFlag).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('rejects a missing S3_ENDPOINT', () => {
    const withoutEndpoint: Record<string, string> = { ...validEnv };
    delete withoutEndpoint.S3_ENDPOINT;
    expect(() => loadEnv(withoutEndpoint)).toThrow(/S3_ENDPOINT/);
  });

  it('rejects a missing S3_PRIVATE_BUCKET', () => {
    const withoutBucket: Record<string, string> = { ...validEnv };
    delete withoutBucket.S3_PRIVATE_BUCKET;
    expect(() => loadEnv(withoutBucket)).toThrow(/S3_PRIVATE_BUCKET/);
  });

  it('rejects a missing S3_PUBLIC_BASE_URL', () => {
    const withoutBaseUrl: Record<string, string> = { ...validEnv };
    delete withoutBaseUrl.S3_PUBLIC_BASE_URL;
    expect(() => loadEnv(withoutBaseUrl)).toThrow(/S3_PUBLIC_BASE_URL/);
  });

  it('leaves Sentry unconfigured and defaults the trace sample rate to 0 when unset', () => {
    const env = loadEnv(validEnv);
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.SENTRY_ENVIRONMENT).toBeUndefined();
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
    expect(env.SENTRY_REQUIRED).toBe(false);
  });

  it('treats an empty-string SENTRY_DSN as unset', () => {
    const env = loadEnv({ ...validEnv, SENTRY_DSN: '' });
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('rejects a malformed SENTRY_DSN', () => {
    expect(() => loadEnv({ ...validEnv, SENTRY_DSN: 'not-a-url' })).toThrow(/SENTRY_DSN/);
  });

  it('accepts a well-formed SENTRY_DSN and a custom trace sample rate', () => {
    const env = loadEnv({
      ...validEnv,
      SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1',
      SENTRY_ENVIRONMENT: 'preview',
      SENTRY_TRACES_SAMPLE_RATE: '0.2',
    });
    expect(env.SENTRY_DSN).toBe('https://public@o0.ingest.sentry.io/1');
    expect(env.SENTRY_ENVIRONMENT).toBe('preview');
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0.2);
  });

  it('boots fine in production without a Sentry DSN when SENTRY_REQUIRED is unset', () => {
    const env = loadEnv({
      ...validEnv,
      NODE_ENV: 'production',
      AUTH_SECRET: 'b'.repeat(32),
      AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      WEB_APP_URL: 'https://photoo.lu',
    });
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('refuses to boot in production when SENTRY_REQUIRED is true and SENTRY_DSN is unset', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        AUTH_SECRET: 'b'.repeat(32),
        AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        WEB_APP_URL: 'https://photoo.lu',
        SENTRY_REQUIRED: 'true',
      }),
    ).toThrow(/SENTRY_DSN/);
  });

  it('boots in production when SENTRY_REQUIRED is true and SENTRY_DSN is set', () => {
    const env = loadEnv({
      ...validEnv,
      NODE_ENV: 'production',
      AUTH_SECRET: 'b'.repeat(32),
      AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      WEB_APP_URL: 'https://photoo.lu',
      SENTRY_REQUIRED: 'true',
      SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1',
    });
    expect(env.SENTRY_DSN).toBe('https://public@o0.ingest.sentry.io/1');
  });
});
