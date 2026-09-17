import type { Readable } from 'node:stream';

// Narrow, hand-written shapes instead of Prisma/AWS SDK types directly: lets
// every processor test build a plain in-memory fake instead of a full
// PrismaClient/S3Client mock, while the real PrismaService/StorageService
// still satisfy these structurally in production.
export interface UploadRow {
  id: string;
  ownerId: string;
  purpose: string;
  status: string;
  mimeType: string;
  declaredSizeBytes: number;
  actualSizeBytes: number | null;
  objectKey: string;
  virusScanStatus: string;
  expiresAt: Date | null;
}

export interface UploadRepository {
  findUnique(args: { where: { id: string } }): Promise<UploadRow | null>;
  findMany(args: { where: Record<string, unknown> }): Promise<UploadRow[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UploadRow>;
}

export interface PortfolioImageRepository {
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface UpdateManyRepository<
  TWhere = Record<string, unknown>,
  TData = Record<string, unknown>,
> {
  updateMany(args: { where: TWhere; data: TData }): Promise<{ count: number }>;
}

export interface PutObjectArgs {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}

export interface ObjectStorage {
  config: { privateBucket: string; publicBucket: string };
  getObjectStream(bucket: string, key: string): Promise<Readable>;
  getObjectBuffer(bucket: string, key: string): Promise<Buffer>;
  putObject(input: PutObjectArgs): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
}

export interface JobQueueLike {
  add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown>;
}
