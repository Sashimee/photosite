import { S3Client } from '@aws-sdk/client-s3';

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  privateBucket: string;
  publicBucket: string;
}

// The one piece of S3 client construction shared by apps/api and
// apps/worker, so bucket names and credentials are always resolved from a
// single S3Config shape instead of being re-read ad hoc in each app. Kept
// out of the package's main entry point (import from '@photoo/shared/storage')
// so apps/web and apps/mobile never pull the AWS SDK into their bundles.
export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
