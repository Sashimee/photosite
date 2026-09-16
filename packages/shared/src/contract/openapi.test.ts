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
        `packages/api-client/openapi.json is missing or unreadable. Run "pnpm --filter @photoo/shared openapi:generate" first. ${String(error)}`,
      );
    }

    const generated = buildOpenApiDocument();

    expect(committed).toEqual(generated);
  });
});
