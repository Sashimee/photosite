import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_ENV } from '../testing/test-env.js';
import { StorageService } from './storage.service.js';

// Assumes the local dev stack's MinIO (or CI's MinIO service, see
// .github/workflows/ci.yml) is reachable, the same way auth.integration.test.ts
// assumes Mailpit is reachable, rather than gating on requireIntegrationEnv:
// S3_* config is required (loadEnv has no fallback), so there is no
// "unset" state to gate on locally.
describe('StorageService against a real MinIO', () => {
  const service = new StorageService(TEST_ENV);
  const createdKeys: string[] = [];

  afterAll(async () => {
    await Promise.all(
      createdKeys.map((key) => service.deleteObject(service.config.privateBucket, key)),
    );
  });

  it('round-trips a put, buffer read, stream read and delete', async () => {
    const key = `worker-storage-test/${randomUUID()}.bin`;
    createdKeys.push(key);
    const body = Buffer.from(`hello ${randomUUID()}`);

    await service.putObject({
      bucket: service.config.privateBucket,
      key,
      body,
      contentType: 'application/octet-stream',
    });

    const buffer = await service.getObjectBuffer(service.config.privateBucket, key);
    expect(buffer.equals(body)).toBe(true);

    const stream = await service.getObjectStream(service.config.privateBucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).equals(body)).toBe(true);

    await service.deleteObject(service.config.privateBucket, key);
    await expect(service.getObjectBuffer(service.config.privateBucket, key)).rejects.toThrow();
  });

  it('writes to the public bucket too', async () => {
    const key = `worker-storage-test/${randomUUID()}.txt`;
    await service.putObject({
      bucket: service.config.publicBucket,
      key,
      body: Buffer.from('public'),
      contentType: 'text/plain',
    });
    const buffer = await service.getObjectBuffer(service.config.publicBucket, key);
    expect(buffer.toString('utf8')).toBe('public');
    await service.deleteObject(service.config.publicBucket, key);
  });
});
