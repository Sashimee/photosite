import type { S3Config } from '@photoo/shared/storage';
import type { Env } from '../config/env.js';

export function s3ConfigFromEnv(config: Env): S3Config {
  return {
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    privateBucket: config.S3_PRIVATE_BUCKET,
    publicBucket: config.S3_PUBLIC_BUCKET,
  };
}
