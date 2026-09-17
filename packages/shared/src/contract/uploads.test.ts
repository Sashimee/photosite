import { describe, expect, it } from 'vitest';
import {
  CreateUploadRequestSchema,
  CreateUploadResponseSchema,
  UploadDownloadResponseSchema,
  UploadSchema,
} from './uploads.js';

const validUpload = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  purpose: 'portfolio',
  status: 'pending_upload',
  mimeType: 'image/jpeg',
  declaredSizeBytes: 1024,
  actualSizeBytes: null,
  virusScanStatus: 'pending',
  createdAt: '2026-09-16T12:00:00.000Z',
};

describe('CreateUploadRequestSchema', () => {
  it('accepts an allowed mime type and size for the purpose', () => {
    expect(
      CreateUploadRequestSchema.safeParse({
        purpose: 'portfolio',
        mimeType: 'image/jpeg',
        sizeBytes: 10 * 1024 * 1024,
      }).success,
    ).toBe(true);
  });

  it('rejects a mime type not allowed for the purpose', () => {
    expect(
      CreateUploadRequestSchema.safeParse({
        purpose: 'avatar',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }).success,
    ).toBe(false);
  });

  it('accepts a document mime type for verification documents', () => {
    expect(
      CreateUploadRequestSchema.safeParse({
        purpose: 'verification_document',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }).success,
    ).toBe(true);
  });

  it('rejects a size over the image limit', () => {
    expect(
      CreateUploadRequestSchema.safeParse({
        purpose: 'portfolio',
        mimeType: 'image/jpeg',
        sizeBytes: 26 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });

  it('rejects a size over the document limit', () => {
    expect(
      CreateUploadRequestSchema.safeParse({
        purpose: 'verification_document',
        mimeType: 'application/pdf',
        sizeBytes: 16 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown purpose', () => {
    expect(
      CreateUploadRequestSchema.safeParse({
        purpose: 'banner',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(
      CreateUploadRequestSchema.safeParse({
        purpose: 'portfolio',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        storageKey: 'portfolio/abc123.jpg',
      }).success,
    ).toBe(false);
  });
});

describe('UploadSchema', () => {
  it('accepts a well-formed upload', () => {
    expect(UploadSchema.safeParse(validUpload).success).toBe(true);
  });

  it('rejects a storageKey field', () => {
    expect(UploadSchema.safeParse({ ...validUpload, storageKey: 'abc' }).success).toBe(false);
  });

  it('rejects a bucket field', () => {
    expect(UploadSchema.safeParse({ ...validUpload, bucket: 'photoo-uploads' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown virusScanStatus', () => {
    expect(UploadSchema.safeParse({ ...validUpload, virusScanStatus: 'unknown' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown status', () => {
    expect(UploadSchema.safeParse({ ...validUpload, status: 'unknown' }).success).toBe(false);
  });

  it('accepts a null actualSizeBytes and rejects zero', () => {
    expect(UploadSchema.safeParse({ ...validUpload, actualSizeBytes: null }).success).toBe(true);
    expect(UploadSchema.safeParse({ ...validUpload, actualSizeBytes: 0 }).success).toBe(false);
  });
});

describe('CreateUploadResponseSchema', () => {
  it('accepts exactly the Content-Type and Content-Length headers', () => {
    const valid = {
      uploadId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      url: 'https://storage.photoo.lu/uploads/abc123',
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '1024' },
      expiresAt: '2026-09-17T12:00:00.000Z',
    };
    expect(CreateUploadResponseSchema.safeParse(valid).success).toBe(true);
    expect(
      CreateUploadResponseSchema.safeParse({
        ...valid,
        headers: { ...valid.headers, 'X-Amz-Extra': 'nope' },
      }).success,
    ).toBe(false);
    expect(
      CreateUploadResponseSchema.safeParse({
        ...valid,
        headers: { 'Content-Type': 'image/jpeg' },
      }).success,
    ).toBe(false);
  });
});

describe('UploadDownloadResponseSchema', () => {
  it('accepts a url with an expiry and rejects storage internals', () => {
    const valid = {
      url: 'https://storage.photoo.lu/uploads/abc123?signature=xyz',
      expiresAt: '2026-09-17T12:00:00.000Z',
    };
    expect(UploadDownloadResponseSchema.safeParse(valid).success).toBe(true);
    expect(
      UploadDownloadResponseSchema.safeParse({ ...valid, bucket: 'photoo-private' }).success,
    ).toBe(false);
  });
});
