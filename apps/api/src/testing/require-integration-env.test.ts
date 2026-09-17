import { afterEach, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from './require-integration-env.js';

describe('requireIntegrationEnv', () => {
  const originalCi = process.env.CI;
  const originalFoo = process.env.FOO_TEST_VAR;
  const originalBar = process.env.BAR_TEST_VAR;

  afterEach(() => {
    process.env.CI = originalCi;
    process.env.FOO_TEST_VAR = originalFoo;
    process.env.BAR_TEST_VAR = originalBar;
  });

  it('returns the requested values when every var is set', () => {
    process.env.FOO_TEST_VAR = 'foo-value';
    process.env.BAR_TEST_VAR = 'bar-value';

    expect(requireIntegrationEnv(['FOO_TEST_VAR', 'BAR_TEST_VAR'])).toEqual({
      FOO_TEST_VAR: 'foo-value',
      BAR_TEST_VAR: 'bar-value',
    });
  });

  it('returns undefined outside CI when a var is missing', () => {
    delete process.env.CI;
    delete process.env.FOO_TEST_VAR;

    expect(requireIntegrationEnv(['FOO_TEST_VAR'])).toBeUndefined();
  });

  it('throws naming the missing vars when CI=true', () => {
    process.env.CI = 'true';
    delete process.env.FOO_TEST_VAR;
    delete process.env.BAR_TEST_VAR;

    expect(() => requireIntegrationEnv(['FOO_TEST_VAR', 'BAR_TEST_VAR'])).toThrow(
      /FOO_TEST_VAR, BAR_TEST_VAR/,
    );
  });

  it('does not throw when CI is set to something other than "true"', () => {
    process.env.CI = '1';
    delete process.env.FOO_TEST_VAR;

    expect(requireIntegrationEnv(['FOO_TEST_VAR'])).toBeUndefined();
  });
});
