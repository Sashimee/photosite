import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCOPE_PATTERN = /^[a-z][a-z0-9]*$/;

// A git worktree's `.git` is a directory in the main checkout and a file
// (`gitdir: <path>`) in every other worktree; either way, walking up from
// `startDir` to the nearest `.git` gives a path that's stable for every
// workspace inside one worktree and distinct across worktrees - no `git`
// binary required, which matters because vitest.config.ts runs before any
// dependency check and this repo's dev containers don't all ship one.
export function findWorktreeRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

export function requireValidScope(scope: string): void {
  if (!SCOPE_PATTERN.test(scope)) {
    throw new Error(`scope must match ${SCOPE_PATTERN.source}, got "${scope}"`);
  }
}
