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
  };
}

describe('claimRedisSlot', () => {
  it('claims slot 1 when the registry is empty', async () => {
    const client = fakeRegistry();
    await expect(claimRedisSlot(client, 'owner-a')).resolves.toBe(1);
  });

  it('probes past slots already owned by someone else', async () => {
    const client = fakeRegistry({
      'photoo:test-slot:1': 'owner-a',
      'photoo:test-slot:2': 'owner-b',
    });
    await expect(claimRedisSlot(client, 'owner-c')).resolves.toBe(3);
  });

  it('reuses the existing slot when the same owner claims again', async () => {
    const client = fakeRegistry();
    const first = await claimRedisSlot(client, 'owner-a');
    await expect(claimRedisSlot(client, 'owner-a')).resolves.toBe(first);
  });

  it('reuses its own slot even when other owners hold earlier slots', async () => {
    const client = fakeRegistry({
      'photoo:test-slot:1': 'owner-a',
      'photoo:test-slot:2': 'owner-b',
    });
    await expect(claimRedisSlot(client, 'owner-b')).resolves.toBe(2);
  });

  it('throws listing every owner when all 15 slots are claimed by others', async () => {
    const initial: Record<string, string> = {};
    for (let slot = 1; slot <= 15; slot++) {
      initial[`photoo:test-slot:${String(slot)}`] = `owner-${String(slot)}`;
    }
    const client = fakeRegistry(initial);

    await expect(claimRedisSlot(client, 'owner-new')).rejects.toThrow(
      /all 15 test Redis slots are claimed/,
    );
    await expect(claimRedisSlot(client, 'owner-new')).rejects.toThrow(/owner-1/);
    await expect(claimRedisSlot(client, 'owner-new')).rejects.toThrow(/owner-15/);
    await expect(claimRedisSlot(client, 'owner-new')).rejects.toThrow(
      /redis-cli -n 0 DEL photoo:test-slot:<n>/,
    );
  });

  it('never returns slot 0', async () => {
    const client = fakeRegistry();
    const slot = await claimRedisSlot(client, 'owner-a');
    expect(slot).toBeGreaterThan(0);
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
