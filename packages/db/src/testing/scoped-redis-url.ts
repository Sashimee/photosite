import { existsSync } from 'node:fs';
import { Redis } from 'ioredis';
import { findWorktreeRoot, requireValidScope } from './worktree-scope.js';

const MAX_SLOT = 15;
const REGISTRY_KEY_PREFIX = 'photoo:test-slot:';
const REGISTRY_DATABASE_INDEX = 0;

// Compare-and-set: only overwrites `KEYS[1]` with the new owner (`ARGV[1]`)
// if it's still empty or still holds the stale owner we saw when we decided
// to reclaim it (`ARGV[2]`). Never a blind SET - if someone else claimed or
// refreshed the slot between our read and this EVAL, `current` won't match
// either branch and the reclaim is rejected instead of stomping a live owner.
const RECLAIM_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false then
  if redis.call('SET', KEYS[1], ARGV[1], 'NX') then
    return 1
  end
  return 0
end
if current == ARGV[2] then
  redis.call('SET', KEYS[1], ARGV[1])
  return 1
end
return 0
`;

class AllSlotsClaimedError extends Error {}

export interface SlotRegistryClient {
  set(key: string, value: string, mode: 'NX'): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

function slotKey(slot: number): string {
  return `${REGISTRY_KEY_PREFIX}${String(slot)}`;
}

function ownerWorktreeRoot(owner: string): string {
  return owner.slice(0, owner.lastIndexOf(':'));
}

// An owner is stale once its worktree directory is gone from disk - removing
// a worktree (e.g. `git worktree remove`) is the only way its vitest process
// never gets to release the slot it claimed, which is how slots leak.
function isStaleOwner(owner: string): boolean {
  return !existsSync(ownerWorktreeRoot(owner));
}

async function tryReclaim(
  client: SlotRegistryClient,
  key: string,
  owner: string,
  staleOwner: string,
): Promise<boolean> {
  return (await client.eval(RECLAIM_SCRIPT, 1, key, owner, staleOwner)) === 1;
}

async function claimSlot(
  client: SlotRegistryClient,
  key: string,
  owner: string,
): Promise<{ claimed: true } | { claimed: false; owner: string | null }> {
  if ((await client.set(key, owner, 'NX')) === 'OK') {
    return { claimed: true };
  }

  let existingOwner = await client.get(key);
  if (existingOwner === null) {
    // The key was deleted between our failed NX and this GET - its owner
    // released it in that gap - so the slot may be free again; give NX one
    // more try before treating it as occupied.
    if ((await client.set(key, owner, 'NX')) === 'OK') {
      return { claimed: true };
    }
    existingOwner = await client.get(key);
  }

  if (existingOwner === owner) {
    return { claimed: true };
  }

  if (
    existingOwner !== null &&
    isStaleOwner(existingOwner) &&
    (await tryReclaim(client, key, owner, existingOwner))
  ) {
    return { claimed: true };
  }

  return { claimed: false, owner: existingOwner };
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
    const outcome = await claimSlot(client, slotKey(slot), owner);
    if (outcome.claimed) {
      return slot;
    }
    occupied.push(`  ${String(slot)}: ${outcome.owner ?? '(released mid-claim, retry)'}`);
  }

  throw new AllSlotsClaimedError(
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
// claimRedisSlot) so two pairs never collide (see docs/ARCHITECTURE.md).
export async function scopedRedisUrl(
  baseUrl: string,
  scope: string,
  worktreeStartDir = process.cwd(),
): Promise<string> {
  requireValidScope(scope);

  const worktreeRoot = findWorktreeRoot(worktreeStartDir);
  const owner = `${worktreeRoot}:${scope}`;

  const registryUrl = withDatabaseIndex(baseUrl, REGISTRY_DATABASE_INDEX);
  const client = new Redis(registryUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  let lastError: Error | undefined;
  client.on('error', (error: Error) => {
    lastError = error;
  });
  try {
    const slot = await claimRedisSlot(client, owner);
    return withDatabaseIndex(baseUrl, slot);
  } catch (error) {
    if (!(error instanceof AllSlotsClaimedError) && lastError) {
      const { hostname, port } = new URL(registryUrl);
      // lastError (from the client's 'error' event) is the specific connection
      // failure (e.g. ECONNREFUSED); the rejected command's own `error` is
      // often just a generic wrapper like "Connection is closed", so lastError
      // is the more useful cause here even though it isn't this catch's param.
      throw new Error(
        `scopedRedisUrl: could not reach Redis at ${hostname}:${port} to claim a test slot: ${lastError.message}`,
        // eslint-disable-next-line preserve-caught-error -- see comment above
        { cause: lastError },
      );
    }
    throw error;
  } finally {
    client.disconnect();
  }
}
