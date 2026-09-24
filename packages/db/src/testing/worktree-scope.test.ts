import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findWorktreeRoot, requireValidScope, SCOPE_PATTERN } from './worktree-scope.js';

describe('findWorktreeRoot', () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('finds a root whose .git is a directory (a normal checkout)', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'photoo-worktree-scope-'));
    mkdirSync(join(tempRoot, '.git'));
    const nested = join(tempRoot, 'apps', 'api');
    mkdirSync(nested, { recursive: true });

    expect(findWorktreeRoot(nested)).toBe(tempRoot);
  });

  it('finds a root whose .git is a file (a git worktree checkout)', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'photoo-worktree-scope-'));
    writeFileSync(join(tempRoot, '.git'), 'gitdir: /some/other/path/.git/worktrees/example\n');
    const nested = join(tempRoot, 'packages', 'db');
    mkdirSync(nested, { recursive: true });

    expect(findWorktreeRoot(nested)).toBe(tempRoot);
  });

  it('returns the start dir unchanged when no ancestor has a .git', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'photoo-worktree-scope-'));
    const isolated = mkdtempSync(join(tempRoot, 'no-git-'));

    expect(findWorktreeRoot(isolated)).toBe(isolated);
  });
});

describe('requireValidScope', () => {
  it('accepts a lowercase-alnum scope starting with a letter', () => {
    expect(() => {
      requireValidScope('api');
    }).not.toThrow();
    expect(() => {
      requireValidScope('worker2');
    }).not.toThrow();
  });

  it.each(['', 'API', '2api', 'api-worker', 'api_worker', 'api worker'])('rejects %j', (scope) => {
    expect(() => {
      requireValidScope(scope);
    }).toThrow(SCOPE_PATTERN.source);
  });
});
