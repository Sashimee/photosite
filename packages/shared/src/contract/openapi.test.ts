import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './generate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const openapiPath = path.resolve(here, '../../../api-client/openapi.json');

describe('openapi document', () => {
  it('matches the committed packages/api-client/openapi.json', () => {
    let committed: unknown;
    try {
      committed = JSON.parse(readFileSync(openapiPath, 'utf8'));
    } catch (error) {
      throw new Error(
        'packages/api-client/openapi.json is missing or unreadable. Run "pnpm --filter @photoo/shared openapi:generate" first.',
        { cause: error },
      );
    }

    const generated = buildOpenApiDocument();

    expect(committed).toEqual(generated);
  });
});

interface OperationLike {
  security?: unknown;
  'x-required-permission'?: unknown;
  'x-requires-2fa'?: unknown;
}

function adminOperations(document: ReturnType<typeof buildOpenApiDocument>) {
  const operations: OperationLike[] = [];
  for (const [pathKey, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathKey.startsWith('/v1/admin/')) continue;
    // An admin must always be able to ask what they may do, so this one
    // route intentionally carries no permission requirement.
    if (pathKey === '/v1/admin/me') continue;
    for (const value of Object.values(pathItem as Record<string, unknown>)) {
      if (value && typeof value === 'object' && 'responses' in value) {
        operations.push(value as OperationLike);
      }
    }
  }
  return operations;
}

describe('admin operations', () => {
  const document = buildOpenApiDocument();
  const operations = adminOperations(document);

  it('finds admin operations to check', () => {
    expect(operations.length).toBeGreaterThan(0);
  });

  it('every admin operation declares its required permission', () => {
    for (const operation of operations) {
      expect(typeof operation['x-required-permission']).toBe('string');
    }
  });

  it('every admin operation uses cookieAuth only', () => {
    for (const operation of operations) {
      expect(operation.security).toEqual([{ cookieAuth: [] }]);
    }
  });

  it('finance operations that mutate money require a fresh 2FA check', () => {
    const financeMutations = operations.filter(
      (operation) => operation['x-required-permission'] === 'finance',
    );
    const with2fa = financeMutations.filter((operation) => operation['x-requires-2fa'] === true);
    expect(with2fa.length).toBeGreaterThan(0);
  });
});

describe('response schemas never leak storage internals', () => {
  it('the generated document has no storageKey, bucket or objectKey property names', () => {
    const document = buildOpenApiDocument();
    const serialized = JSON.stringify(document);
    expect(serialized).not.toMatch(/"storageKey"/i);
    expect(serialized).not.toMatch(/"bucket"/i);
    expect(serialized).not.toMatch(/"objectKey"/i);
  });
});
