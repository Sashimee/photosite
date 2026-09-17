import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/photoo',
  REDIS_URL: 'redis://127.0.0.1:6379',
  PORT: '4000',
  PUBLIC_API_URL: 'http://localhost:4000',
  WEB_ORIGINS: 'http://localhost:3000',
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
});
