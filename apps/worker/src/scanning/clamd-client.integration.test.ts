import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { eicarTestString } from '../testing/eicar.js';
import { scanStream } from './clamd-client.js';

const RUN_AGAINST_REAL_CLAMAV = process.env.CLAMAV_INTEGRATION_TEST === 'true';

// Allowed CI exception (docs/steps/1A.3-uploads.md): clamav's first-boot
// freshclam download is too slow for CI, so this needs CLAMAV_INTEGRATION_TEST=true.
describe.skipIf(!RUN_AGAINST_REAL_CLAMAV)(
  'scanStream against the real clamav dev-stack service (skipped unless CLAMAV_INTEGRATION_TEST=true, and always skipped in CI by design)',
  () => {
    const options = {
      host: process.env.CLAMAV_HOST ?? '127.0.0.1',
      port: Number(process.env.CLAMAV_PORT ?? 3310),
      maxBytes: 25 * 1024 * 1024,
      timeoutMs: 30_000,
    };

    it('reports a clean buffer as clean', async () => {
      const result = await scanStream(
        Readable.from([Buffer.from('just a harmless test file')]),
        options,
      );
      expect(result).toEqual({ status: 'clean' });
    });

    it('reports the EICAR test string as infected', async () => {
      const result = await scanStream(Readable.from([Buffer.from(eicarTestString())]), options);
      expect(result.status).toBe('infected');
    });
  },
);
