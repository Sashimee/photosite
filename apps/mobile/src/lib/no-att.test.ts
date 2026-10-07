import { describe, expect, it } from '@jest/globals';

import pkg from '../../package.json';
import config from '../../app.config';

describe('iOS App Tracking Transparency', () => {
  it('is not shipped while no ads attribution is used', () => {
    const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(dependencies.filter((name) => name.includes('tracking-transparency'))).toEqual([]);

    const resolved = JSON.stringify(config);
    expect(resolved).not.toContain('NSUserTrackingUsageDescription');
    expect(resolved).not.toContain('tracking-transparency');
  });
});
