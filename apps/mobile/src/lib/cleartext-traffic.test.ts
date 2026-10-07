import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { enableCleartextTraffic } from '../../plugins/with-cleartext-traffic';

const pluginPath = './plugins/with-cleartext-traffic';
const loadAppConfig = (): { default: unknown } => jest.requireActual('../../app.config');
const originalFlag = process.env.E2E_BUILD;

function hasCleartextPlugin(): boolean {
  let plugins: unknown[] | undefined;
  jest.isolateModules(() => {
    plugins = (loadAppConfig().default as { plugins?: unknown[] }).plugins;
  });
  return plugins?.includes(pluginPath) ?? false;
}

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.E2E_BUILD;
  } else {
    process.env.E2E_BUILD = originalFlag;
  }
});

describe('Android cleartext traffic', () => {
  it('is not enabled when E2E_BUILD is unset', () => {
    delete process.env.E2E_BUILD;
    expect(hasCleartextPlugin()).toBe(false);
  });

  it.each(['0', 'true', ''])('is not enabled when E2E_BUILD is %p', (value) => {
    process.env.E2E_BUILD = value;
    expect(hasCleartextPlugin()).toBe(false);
  });

  it('is enabled when E2E_BUILD is 1', () => {
    process.env.E2E_BUILD = '1';
    expect(hasCleartextPlugin()).toBe(true);
  });

  it('sets usesCleartextTraffic on the application element', () => {
    const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    const result = enableCleartextTraffic(manifest as never);
    expect(result.manifest.application?.[0]?.$['android:usesCleartextTraffic']).toBe('true');
    expect(result.manifest.application?.[0]?.$['android:name']).toBe('.MainApplication');
  });

  it('fails loudly when the manifest has no application element', () => {
    expect(() => enableCleartextTraffic({ manifest: {} } as never)).toThrow(/no <application>/);
  });
});
