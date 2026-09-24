import { Redis } from 'ioredis';
import { findWorktreeRoot, requireValidScope } from './worktree-scope.js';

const MAX_SLOT = 15;
const REGISTRY_KEY_PREFIX = 'photoo:test-slot:';
const REGISTRY_DATABASE_INDEX = 0;

export interface SlotRegistryClient {
  set(key: string, value: string, mode: 'NX'): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
}

function slotKey(slot: number): string {
  return `${REGISTRY_KEY_PREFIX}${String(slot)}`;
}

// Claims one of Redis logical databases 1-15 for `owner` (a worktree root +
// workspace pair), never 0 - that's the registry's own database, and the
// index REDIS_URL defaults to with no path, so it's also where dev servers
// actually run. `SET ... NX` makes each attempt atomic against every other
// process racing the same registry; a slot already owned by `owner` is
// reused instead of reclaimed, so repeated calls from the same
// worktree/workspace converge on one index instead of leaking a new one.
export async function claimRedisSlot(client: SlotRegistryClient, owner: string): Promise<number> {
  const occupied: string[] = [];
  for (let slot = 1; slot <= MAX_SLOT; slot++) {
    const key = slotKey(slot);
    if ((await client.set(key, owner, 'NX')) === 'OK') {
      return slot;
    }
    const existingOwner = await client.get(key);
    if (existingOwner === owner) {
      return slot;
    }
    occupied.push(`  ${String(slot)}: ${existingOwner ?? '(released mid-claim, retry)'}`);
  }

  throw new Error(
    `scopedRedisUrl: all ${String(MAX_SLOT)} test Redis slots are claimed and none belongs to this worktree/workspace:\n` +
      `${occupied.join('\n')}\n` +
      `Free a slot for a worktree/workspace that no longer exists with ` +
      `'redis-cli -n ${String(REGISTRY_DATABASE_INDEX)} DEL ${REGISTRY_KEY_PREFIX}<n>'.`,
  );
}

export function withDatabaseIndex(baseUrl: string, index: number): string {
  const url = new URL(baseUrl);
  url.pathname = `/${String(index)}`;
  return url.toString();
}

// Picks a Redis logical database for `scope` scoped to `(git worktree root,
// workspace)`, claimed through a slot registry kept in database 0 (see
// claimRedisSlot) so two pairs never collide - unlike a hash of the pair,
// which this replaced (see docs/ARCHITECTURE.md).
export async function scopedRedisUrl(
  baseUrl: string,
  scope: string,
  worktreeStartDir = process.cwd(),
): Promise<string> {
  requireValidScope(scope);

  const worktreeRoot = findWorktreeRoot(worktreeStartDir);
  const owner = `${worktreeRoot}:${scope}`;

  const client = new Redis(withDatabaseIndex(baseUrl, REGISTRY_DATABASE_INDEX), {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  try {
    const slot = await claimRedisSlot(client, owner);
    return withDatabaseIndex(baseUrl, slot);
  } finally {
    client.disconnect();
  }
}
