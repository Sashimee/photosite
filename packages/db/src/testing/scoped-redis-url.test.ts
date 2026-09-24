import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimRedisSlot, withDatabaseIndex, type SlotRegistryClient } from './scoped-redis-url.js';

function fakeRegistry(initial: Record<string, string> = {}): SlotRegistryClient {
  const store = new Map(Object.entries(initial));
  return {
    set(key, value) {
      if (store.has(key)) {
        return Promise.resolve(null);
      }
      store.set(key, value);
      return Promise.resolve('OK');
    },
    get(key) {
      return Promise.resolve(store.get(key) ?? null);
    },
    eval(_script, _numKeys, key, newOwner, staleOwner) {
      const current = store.get(key) ?? null;
      if (current === null || current === staleOwner) {
        store.set(key, newOwner);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    },
  };
}

describe('claimRedisSlot', () => {
  it('claims slot 1 when the registry is empty', async () => {
    const client = fakeRegistry();
    await expect(claimRedisSlot(client, 'owner-a')).resolves.toBe(1);
  });

  it('probes past slots already owned by someone else', async () => {
    const client = fakeRegistry({
      'photoo:test-slot:1': `${tmpdir()}:owner-a`,
      'photoo:test-slot:2': `${tmpdir()}:owner-b`,
    });
    await expect(claimRedisSlot(client, `${tmpdir()}:owner-c`)).resolves.toBe(3);
  });

  it('reuses the existing slot when the same owner claims again', async () => {
    const client = fakeRegistry();
    const first = await claimRedisSlot(client, 'owner-a');
    await expect(claimRedisSlot(client, 'owner-a')).resolves.toBe(first);
  });

  it('reuses its own slot even when other owners hold earlier slots', async () => {
    const client = fakeRegistry({
      'photoo:test-slot:1': `${tmpdir()}:owner-a`,
      'photoo:test-slot:2': `${tmpdir()}:owner-b`,
    });
    await expect(claimRedisSlot(client, `${tmpdir()}:owner-b`)).resolves.toBe(2);
  });

  it('throws listing every owner when all 15 slots are claimed by others', async () => {
    const initial: Record<string, string> = {};
    for (let slot = 1; slot <= 15; slot++) {
      initial[`photoo:test-slot:${String(slot)}`] = `${tmpdir()}:owner-${String(slot)}`;
    }
    const client = fakeRegistry(initial);

    await expect(claimRedisSlot(client, `${tmpdir()}:owner-new`)).rejects.toThrow(
      /all 15 test Redis slots are claimed/,
    );
    await expect(claimRedisSlot(client, `${tmpdir()}:owner-new`)).rejects.toThrow(/owner-1/);
    await expect(claimRedisSlot(client, `${tmpdir()}:owner-new`)).rejects.toThrow(/owner-15/);
    await expect(claimRedisSlot(client, `${tmpdir()}:owner-new`)).rejects.toThrow(
      /redis-cli -n 0 DEL photoo:test-slot:<n>/,
    );
  });

  it('retries the same slot once when GET returns null right after a failed NX', async () => {
    let setCalls = 0;
    const client: SlotRegistryClient = {
      set() {
        setCalls++;
        return Promise.resolve(setCalls === 1 ? null : 'OK');
      },
      get() {
        return Promise.resolve(null);
      },
      eval() {
        throw new Error('eval should not be called: the retried NX should have claimed the slot');
      },
    };

    await expect(claimRedisSlot(client, 'owner-a')).resolves.toBe(1);
    expect(setCalls).toBe(2);
  });

  it('reclaims a slot whose owner worktree no longer exists on disk', async () => {
    const staleRoot = mkdtempSync(join(tmpdir(), 'photoo-scoped-redis-stale-'));
    rmSync(staleRoot, { recursive: true, force: true });

    const client = fakeRegistry({ 'photoo:test-slot:1': `${staleRoot}:db` });
    await expect(claimRedisSlot(client, `${tmpdir()}:worker`)).resolves.toBe(1);
  });

  it('does not reclaim a slot whose owner worktree still exists on disk', async () => {
    const liveRoot = mkdtempSync(join(tmpdir(), 'photoo-scoped-redis-live-'));
    try {
      const client = fakeRegistry({ 'photoo:test-slot:1': `${liveRoot}:db` });
      await expect(claimRedisSlot(client, `${tmpdir()}:worker`)).resolves.toBe(2);
    } finally {
      rmSync(liveRoot, { recursive: true, force: true });
    }
  });
});

describe('withDatabaseIndex', () => {
  it('replaces an existing database index in the path', () => {
    expect(withDatabaseIndex('redis://localhost:6379/3', 7)).toBe('redis://localhost:6379/7');
  });

  it('adds a database index when the URL has none', () => {
    expect(withDatabaseIndex('redis://localhost:6379', 5)).toBe('redis://localhost:6379/5');
  });

  it('preserves the rediss:// scheme', () => {
    expect(withDatabaseIndex('rediss://localhost:6380/0', 2)).toBe('rediss://localhost:6380/2');
  });

  it('preserves query params', () => {
    expect(withDatabaseIndex('redis://localhost:6379/0?family=0', 4)).toBe(
      'redis://localhost:6379/4?family=0',
    );
  });

  it('preserves credentials', () => {
    expect(withDatabaseIndex('redis://user:pass@localhost:6379/0', 9)).toBe(
      'redis://user:pass@localhost:6379/9',
    );
  });
});
