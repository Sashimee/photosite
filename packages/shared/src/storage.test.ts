import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { createS3Client, type S3Config } from './storage.js';

const CONFIG: S3Config = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'eu-west-1',
  accessKeyId: 'photoo_dev',
  secretAccessKey: 'photoo_dev_password',
  forcePathStyle: true,
  privateBucket: 'photoo-private',
  publicBucket: 'photoo-public',
};

describe('createS3Client', () => {
  it('builds an S3Client using the given endpoint, region and path style', async () => {
    const client = createS3Client(CONFIG);
    expect(client).toBeInstanceOf(S3Client);
    await expect(client.config.endpoint?.()).resolves.toMatchObject({
      hostname: '127.0.0.1',
      port: 9000,
    });
    expect(await client.config.region()).toBe('eu-west-1');
    expect(client.config.forcePathStyle).toBe(true);
    client.destroy();
  });
});
