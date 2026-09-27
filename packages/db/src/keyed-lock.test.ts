import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createKeyedLock } from './index.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createKeyedLock', () => {
  if (!testEnv) {
    it.skip('serialises work per key (skipped: TEST_DATABASE_URL is not set)');
    return;
  }

  const lock = createKeyedLock(testEnv.TEST_DATABASE_URL);

  afterAll(async () => {
    await lock.end();
  });

  it('refuses a second holder of the same key while the first runs', async () => {
    const key = `test:${randomUUID()}`;
    const inside = deferred();
    const leave = deferred();
    const first = lock.tryRun(key, async () => {
      inside.resolve();
      await leave.promise;
      return 'first';
    });
    await inside.promise;

    await expect(lock.tryRun(key, () => Promise.resolve('second'))).resolves.toEqual({
      acquired: false,
    });
    leave.resolve();
    await expect(first).resolves.toEqual({ acquired: true, value: 'first' });
  });

  it('lets a different key run alongside', async () => {
    const leave = deferred();
    const inside = deferred();
    const first = lock.tryRun(`test:${randomUUID()}`, async () => {
      inside.resolve();
      await leave.promise;
    });
    await inside.promise;

    await expect(lock.tryRun(`test:${randomUUID()}`, () => Promise.resolve(1))).resolves.toEqual({
      acquired: true,
      value: 1,
    });
    leave.resolve();
    await first;
  });

  it('frees the key after the work throws', async () => {
    const key = `test:${randomUUID()}`;
    await expect(lock.tryRun(key, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    await expect(lock.tryRun(key, () => Promise.resolve('again'))).resolves.toEqual({
      acquired: true,
      value: 'again',
    });
  });

  it('frees the key for the next caller once the holder finishes', async () => {
    const key = `test:${randomUUID()}`;
    await lock.tryRun(key, () => Promise.resolve(null));

    await expect(lock.tryRun(key, () => Promise.resolve('next'))).resolves.toEqual({
      acquired: true,
      value: 'next',
    });
  });
});
