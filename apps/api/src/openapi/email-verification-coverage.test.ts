import { buildOpenApiDocument } from '@photoo/shared';
import { describe, expect, it } from 'vitest';

interface OperationLike {
  security?: unknown;
  'x-requires-verified-email'?: unknown;
}

// The marketplace surfaces docs/SECURITY.md's "any marketplace action" is
// actually about (issue #273): requests, quotes, the job board and the
// professional profile that self-grants the professional role. Every
// authenticated operation under these prefixes must say `true` or `false`
// explicitly, the same way `x-required-permission` forces every admin
// operation to declare its permission (contract-coverage.test.ts) — so
// adding a new route here without deciding is a failing test, not a
// silent gap.
const MARKETPLACE_PATH_PREFIXES = [
  '/v1/requests',
  '/v1/quotes',
  '/v1/photographers/{slug}/products/{productId}/quotes',
  '/v1/me/professional-profile',
  '/v1/me/job-offers',
  '/v1/job-offers',
  '/v1/job-applications',
  '/v1/me/job-applications',
];

function isUnderMarketplacePrefix(path: string): boolean {
  return MARKETPLACE_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function hasSessionSecurity(security: unknown): boolean {
  return (
    Array.isArray(security) &&
    security.some(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        ('cookieAuth' in entry || 'bearerAuth' in entry),
    )
  );
}

function marketplaceSessionOperations(document: ReturnType<typeof buildOpenApiDocument>) {
  const operations: { path: string; method: string; operation: OperationLike }[] = [];
  for (const [pathKey, pathItem] of Object.entries(document.paths ?? {})) {
    if (!isUnderMarketplacePrefix(pathKey)) continue;
    for (const [method, value] of Object.entries(pathItem as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || !('responses' in value)) continue;
      const operation = value as OperationLike;
      if (!hasSessionSecurity(operation.security)) continue;
      operations.push({ path: pathKey, method, operation });
    }
  }
  return operations;
}

describe('email verification coverage', () => {
  const document = buildOpenApiDocument();
  const operations = marketplaceSessionOperations(document);

  it('finds session-authenticated marketplace operations to check', () => {
    expect(operations.length).toBeGreaterThan(0);
  });

  it('every session-authenticated marketplace operation declares x-requires-verified-email', () => {
    for (const { path, method, operation } of operations) {
      expect(
        typeof operation['x-requires-verified-email'],
        `${method.toUpperCase()} ${path} is missing x-requires-verified-email`,
      ).toBe('boolean');
    }
  });

  it('the actions the issue calls out are all gated', () => {
    const gated = new Set(
      operations
        .filter((entry) => entry.operation['x-requires-verified-email'] === true)
        .map((entry) => `${entry.method.toUpperCase()} ${entry.path}`),
    );
    expect(gated).toEqual(
      new Set([
        'POST /v1/requests',
        'POST /v1/quotes',
        'POST /v1/photographers/{slug}/products/{productId}/quotes',
        'POST /v1/me/professional-profile',
        'POST /v1/me/job-offers/{id}/publish',
        'POST /v1/job-offers/{id}/applications',
      ]),
    );
  });
});
