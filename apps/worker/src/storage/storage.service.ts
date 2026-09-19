import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Inject, Injectable } from '@nestjs/common';
import { createS3Client, type S3Config } from '@photoo/shared/storage';
import { APP_CONFIG, type Env } from '../config/env.js';
import { s3ConfigFromEnv } from './s3-config.js';

export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}

export interface PutObjectStreamInput {
  bucket: string;
  key: string;
  body: Readable;
  contentType: string;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  readonly config: S3Config;

  constructor(@Inject(APP_CONFIG) env: Env) {
    this.config = s3ConfigFromEnv(env);
    this.client = createS3Client(this.config);
  }

  async getObjectStream(bucket: string, key: string): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return result.Body as Readable;
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.getObjectStream(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async putObject(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  // Multipart under the hood (@aws-sdk/lib-storage buffers a handful of
  // parts, not the whole body), so a GDPR export archive of arbitrary size
  // never sits fully in memory or on local disk (docs/steps/1A.12-gdpr.md
  // "the worker streams it").
  async putObjectStream(input: PutObjectStreamInput): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      },
    });
    await upload.done();
  }
}
