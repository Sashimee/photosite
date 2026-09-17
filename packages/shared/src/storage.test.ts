import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createS3Client, putPublicObject, type S3Config } from './storage.js';

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

describe('putPublicObject', () => {
  it('sends a PutObjectCommand with the given bucket, key, body and content type', async () => {
    const send = vi.fn<(command: PutObjectCommand) => Promise<Record<string, never>>>(() =>
      Promise.resolve({}),
    );
    const client = { send } as unknown as S3Client;
    const body = Buffer.from('hello');

    await putPublicObject(client, 'photoo-public', 'v/example/thumb.jpg', body, 'image/jpeg');

    expect(send).toHaveBeenCalledTimes(1);
    const [command] = send.mock.calls[0] as [PutObjectCommand];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'photoo-public',
      Key: 'v/example/thumb.jpg',
      Body: body,
      ContentType: 'image/jpeg',
    });
  });
});
