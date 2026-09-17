import { HttpException, Inject, Injectable } from '@nestjs/common';
import { UPLOAD_PURPOSE_LIMITS, type UploadPurpose } from '@photoo/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { randomUuidV7 } from '../auth/uuid-v7.js';
import { FileScanQueueService } from './file-scan-queue.service.js';
import { mapUpload } from './upload-mapper.js';

const PENDING_UPLOAD_TTL_MS = 10 * 60 * 1000;
const PUT_URL_EXPIRY_SECONDS = 10 * 60;
const GET_URL_EXPIRY_SECONDS = 5 * 60;

export interface CreateUploadInput {
  purpose: UploadPurpose;
  mimeType: string;
  sizeBytes: number;
}

export interface CreateUploadResult {
  uploadId: string;
  url: string;
  headers: { 'Content-Type': string; 'Content-Length': string };
  expiresAt: string;
}

export interface DownloadResult {
  url: string;
  expiresAt: string;
}

@Injectable()
export class UploadsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(FileScanQueueService) private readonly fileScanQueue: FileScanQueueService,
  ) {}

  async createUpload(ownerId: string, input: CreateUploadInput): Promise<CreateUploadResult> {
    const id = randomUuidV7();
    const objectKey = `u/${ownerId}/${id}`;
    const expiresAt = new Date(Date.now() + PENDING_UPLOAD_TTL_MS);

    await this.prisma.client.upload.create({
      data: {
        id,
        ownerId,
        purpose: input.purpose,
        mimeType: input.mimeType,
        declaredSizeBytes: input.sizeBytes,
        objectKey,
        expiresAt,
      },
    });

    const url = await this.storage.presignPut({
      bucket: this.storage.config.privateBucket,
      key: objectKey,
      contentType: input.mimeType,
      contentLength: input.sizeBytes,
      expiresInSeconds: PUT_URL_EXPIRY_SECONDS,
    });

    return {
      uploadId: id,
      url,
      headers: { 'Content-Type': input.mimeType, 'Content-Length': String(input.sizeBytes) },
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getStatus(ownerId: string, id: string): Promise<ReturnType<typeof mapUpload>> {
    const upload = await this.findOwned(ownerId, id);
    return mapUpload(upload);
  }

  async complete(ownerId: string, id: string): Promise<ReturnType<typeof mapUpload>> {
    const upload = await this.findOwned(ownerId, id);

    if (upload.status !== 'pending_upload') {
      return mapUpload(upload);
    }

    const head = await this.storage.headObject(this.storage.config.privateBucket, upload.objectKey);
    if (!head) {
      throw new HttpException(
        { code: 'CONFLICT', message: 'The file was never uploaded to the presigned URL' },
        409,
      );
    }

    const limit = UPLOAD_PURPOSE_LIMITS[upload.purpose];
    const matchesDeclaredSize = head.sizeBytes === upload.declaredSizeBytes;
    const withinPurposeLimit = head.sizeBytes <= limit.maxSizeBytes;
    const matchesDeclaredType = head.contentType === upload.mimeType;

    if (!matchesDeclaredSize || !withinPurposeLimit || !matchesDeclaredType) {
      await this.storage.deleteObject(this.storage.config.privateBucket, upload.objectKey);
      await this.prisma.client.upload.update({
        where: { id: upload.id },
        data: { status: 'failed' },
      });
      throw new HttpException(
        { code: 'CONFLICT', message: 'The uploaded file does not match the declared upload' },
        409,
      );
    }

    const finalKey = `o/${upload.ownerId}/${upload.id}`;
    await this.storage.copyObject({
      sourceBucket: this.storage.config.privateBucket,
      sourceKey: upload.objectKey,
      destinationBucket: this.storage.config.privateBucket,
      destinationKey: finalKey,
      contentType: upload.mimeType,
    });
    await this.storage.deleteObject(this.storage.config.privateBucket, upload.objectKey);

    const updated = await this.prisma.client.upload.update({
      where: { id: upload.id },
      data: { status: 'uploaded', actualSizeBytes: head.sizeBytes, objectKey: finalKey },
    });

    await this.fileScanQueue.enqueue({ uploadId: updated.id });

    return mapUpload(updated);
  }

  async presignDownload(ownerId: string, id: string): Promise<DownloadResult> {
    const upload = await this.findOwned(ownerId, id);

    const isReady =
      upload.virusScanStatus === 'clean' &&
      (upload.status === 'clean' || upload.status === 'processed');
    if (!isReady) {
      throw new HttpException(
        { code: 'CONFLICT', message: 'Upload is not available for download yet' },
        409,
      );
    }

    const url = await this.storage.presignGet({
      bucket: this.storage.config.privateBucket,
      key: upload.objectKey,
      expiresInSeconds: GET_URL_EXPIRY_SECONDS,
      responseContentType: upload.mimeType,
      ...(upload.status === 'processed' ? {} : { responseContentDisposition: 'attachment' }),
    });

    return { url, expiresAt: new Date(Date.now() + GET_URL_EXPIRY_SECONDS * 1000).toISOString() };
  }

  private async findOwned(ownerId: string, id: string) {
    const upload = await this.prisma.client.upload.findUnique({ where: { id } });
    if (upload?.ownerId !== ownerId) {
      throw new HttpException({ code: 'NOT_FOUND', message: 'Upload not found' }, 404);
    }
    return upload;
  }
}
