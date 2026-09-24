import { createHash } from 'node:crypto';
import { findWorktreeRoot, requireValidScope } from './worktree-scope.js';

const LOGICAL_DATABASE_COUNT = 16;

// Redis ships 16 logical databases (SELECT 0-15) on one server, which is a
// far smaller keyspace than Postgres's "create another database" - a hash
// collision between two (worktree, workspace) pairs is plausible once more
// than a handful are active at once, unlike the Postgres clone which is
// structurally collision-free. Good enough for this repo's realistic
// worktree count, and it's a deterministic collision (the same pair always
// picks the same index), not a random one, so it stays debuggable rather
// than flaky - see docs/ARCHITECTURE.md for the full tradeoff.
//
// Covers BullMQ queue names and rate-limit/lockout keys (ordinary keys in
// whichever index the connection selected). Does not cover Socket.IO's
// redis-adapter pub/sub, which Redis broadcasts across every logical
// database regardless of SELECT - see socket-io-redis-adapter.ts.
export function scopedRedisUrl(
  baseUrl: string,
  scope: string,
  worktreeStartDir = process.cwd(),
): string {
  requireValidScope(scope);

  const worktreeRoot = findWorktreeRoot(worktreeStartDir);
  const digest = createHash('sha1').update(`${worktreeRoot}:${scope}`).digest();
  const databaseIndex = digest.readUInt32BE(0) % LOGICAL_DATABASE_COUNT;

  const url = new URL(baseUrl);
  url.pathname = `/${String(databaseIndex)}`;
  return url.toString();
}
