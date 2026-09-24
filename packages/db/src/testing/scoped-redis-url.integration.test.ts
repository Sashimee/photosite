import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from './require-integration-env.js';
import { scopedRedisUrl } from './scoped-redis-url.js';

const testEnv = requireIntegrationEnv(['REDIS_URL']);

function tempWorktree(): string {
  const root = mkdtempSync(join(tmpdir(), 'photoo-scoped-redis-url-'));
  mkdirSync(join(root, '.git'));
  return root;
}

function randomScope(): string {
  return `t${randomBytes(4).toString('hex')}`;
}

describe('scopedRedisUrl integration', () => {
  if (!testEnv) {
    it.skip('skipped: REDIS_URL is not set', () => undefined);
    return;
  }

  const worktrees: string[] = [];
  const registryKeys: string[] = [];
  let registry: Redis;

  afterEach(() => {
    for (const worktree of worktrees.splice(0)) {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    registry = new Redis(testEnv.REDIS_URL);
    if (registryKeys.length > 0) {
      await registry.del(...registryKeys);
    }
    await registry.quit();
  });

  it('claims a non-zero database index for a fresh worktree/scope pair', async () => {
    const worktree = tempWorktree();
    worktrees.push(worktree);
    const scope = randomScope();

    const url = await scopedRedisUrl(testEnv.REDIS_URL, scope, worktree);
    registryKeys.push(`photoo:test-slot:${new URL(url).pathname.slice(1)}`);

    const index = Number(new URL(url).pathname.slice(1));
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThanOrEqual(15);
  });

  it('gives distinct worktree/scope pairs distinct database indices', async () => {
    const worktreeA = tempWorktree();
    const worktreeB = tempWorktree();
    worktrees.push(worktreeA, worktreeB);
    const scope = randomScope();

    const urlA = await scopedRedisUrl(testEnv.REDIS_URL, scope, worktreeA);
    const urlB = await scopedRedisUrl(testEnv.REDIS_URL, scope, worktreeB);
    const indexA = new URL(urlA).pathname.slice(1);
    const indexB = new URL(urlB).pathname.slice(1);
    registryKeys.push(`photoo:test-slot:${indexA}`, `photoo:test-slot:${indexB}`);

    expect(indexA).not.toBe(indexB);
  });

  it('reuses the same database index on a repeat call for the same worktree/scope pair', async () => {
    const worktree = tempWorktree();
    worktrees.push(worktree);
    const scope = randomScope();

    const first = await scopedRedisUrl(testEnv.REDIS_URL, scope, worktree);
    const second = await scopedRedisUrl(testEnv.REDIS_URL, scope, worktree);
    registryKeys.push(`photoo:test-slot:${new URL(first).pathname.slice(1)}`);

    expect(second).toBe(first);
  });
});
