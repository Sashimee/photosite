import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { createS3Client, type S3Config } from '@photoo/shared/storage';
import { APP_CONFIG, type Env } from '../config/env.js';
import { s3ConfigFromEnv } from './s3-config.js';

export interface PresignPutInput {
  bucket: string;
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds: number;
}

export interface PresignGetInput {
  bucket: string;
  key: string;
  expiresInSeconds: number;
  responseContentType?: string;
  responseContentDisposition?: string;
}

export interface HeadObjectResult {
  sizeBytes: number;
  contentType: string | undefined;
}

export interface CopyObjectInput {
  sourceBucket: string;
  sourceKey: string;
  destinationBucket: string;
  destinationKey: string;
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

  async presignPut(input: PresignPutInput): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    return getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
  }

  // MinIO (and S3) only include Content-Length, not Content-Type, in the
  // presigned URL's signed headers (confirmed against the local dev stack:
  // `X-Amz-SignedHeaders=content-length;host`), so a PUT with a different
  // Content-Type than declared here still succeeds. Content-Type is
  // therefore never enforced by the signature; `UploadsService.complete`'s
  // HEAD-based check is the actual, load-bearing enforcement for it.
  async presignGet(input: PresignGetInput): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ResponseContentType: input.responseContentType,
      ResponseContentDisposition: input.responseContentDisposition,
    });
    return getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
  }

  async copyObject(input: CopyObjectInput): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: input.destinationBucket,
        Key: input.destinationKey,
        CopySource: `/${input.sourceBucket}/${encodeURIComponent(input.sourceKey)}`,
        MetadataDirective: 'REPLACE',
        ContentType: input.contentType,
      }),
    );
  }

  async headObject(bucket: string, key: string): Promise<HeadObjectResult | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (error instanceof NotFound) {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
