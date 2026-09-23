import { UPLOAD_STATUSES, VIRUS_SCAN_STATUSES } from '../enums.js';
import { IdSchema, IsoDateTimeSchema, errorResponses } from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const UPLOAD_PURPOSES = [
  'portfolio',
  'avatar',
  'cover',
  'logo',
  'chat_attachment',
  'verification_document',
  'delivery_file',
] as const;

export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const PUBLIC_UPLOAD_PURPOSES = [
  'portfolio',
  'avatar',
  'cover',
  'logo',
] as const satisfies readonly UploadPurpose[];

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

const IMAGE_MAX_SIZE_BYTES = 25 * 1024 * 1024;
const DOCUMENT_MAX_SIZE_BYTES = 15 * 1024 * 1024;

export const UPLOAD_PURPOSE_LIMITS: Record<
  UploadPurpose,
  { mimeTypes: readonly string[]; maxSizeBytes: number }
> = {
  portfolio: { mimeTypes: IMAGE_MIME_TYPES, maxSizeBytes: IMAGE_MAX_SIZE_BYTES },
  avatar: { mimeTypes: IMAGE_MIME_TYPES, maxSizeBytes: IMAGE_MAX_SIZE_BYTES },
  cover: { mimeTypes: IMAGE_MIME_TYPES, maxSizeBytes: IMAGE_MAX_SIZE_BYTES },
  logo: { mimeTypes: IMAGE_MIME_TYPES, maxSizeBytes: IMAGE_MAX_SIZE_BYTES },
  chat_attachment: {
    mimeTypes: [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES],
    maxSizeBytes: IMAGE_MAX_SIZE_BYTES,
  },
  verification_document: {
    mimeTypes: [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES],
    maxSizeBytes: DOCUMENT_MAX_SIZE_BYTES,
  },
  delivery_file: {
    mimeTypes: IMAGE_MIME_TYPES,
    maxSizeBytes: IMAGE_MAX_SIZE_BYTES,
  },
};

export const UploadPurposeSchema = z.enum(UPLOAD_PURPOSES).openapi({ example: 'portfolio' });

export const MimeTypeSchema = z
  .string()
  .min(3)
  .max(127)
  .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/, 'must be a valid mime type')
  .openapi({ example: 'image/jpeg' });

export const UploadSchema = z
  .object({
    id: IdSchema,
    purpose: UploadPurposeSchema,
    status: z.enum(UPLOAD_STATUSES).openapi({ example: 'processed' }),
    mimeType: MimeTypeSchema,
    declaredSizeBytes: z.int().positive(),
    actualSizeBytes: z.int().positive().nullable(),
    virusScanStatus: z.enum(VIRUS_SCAN_STATUSES),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('Upload');

function mimeTypeAllowedForPurpose(data: { purpose: UploadPurpose; mimeType: string }) {
  return UPLOAD_PURPOSE_LIMITS[data.purpose].mimeTypes.includes(data.mimeType);
}

function sizeWithinLimitForPurpose(data: { purpose: UploadPurpose; sizeBytes: number }) {
  return data.sizeBytes <= UPLOAD_PURPOSE_LIMITS[data.purpose].maxSizeBytes;
}

export const CreateUploadRequestSchema = z
  .object({
    purpose: UploadPurposeSchema,
    mimeType: MimeTypeSchema,
    sizeBytes: z.int().positive(),
  })
  .strict()
  .refine(mimeTypeAllowedForPurpose, {
    message: 'mimeType is not allowed for the declared purpose',
    path: ['mimeType'],
  })
  .refine(sizeWithinLimitForPurpose, {
    message: 'sizeBytes exceeds the limit for the declared purpose',
    path: ['sizeBytes'],
  });

export const CreateUploadResponseSchema = z
  .object({
    uploadId: IdSchema,
    url: z.url().openapi({ example: 'https://storage.photoo.lu/uploads/abc123' }),
    headers: z
      .object({
        'Content-Type': z.string().openapi({ example: 'image/jpeg' }),
        'Content-Length': z.string().openapi({ example: '1024' }),
      })
      .strict()
      .openapi({
        description: 'Headers the client must send exactly as given on the presigned PUT',
      }),
    expiresAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('CreateUploadResponse');

export const UploadDownloadResponseSchema = z
  .object({
    url: z.url().openapi({ example: 'https://storage.photoo.lu/uploads/abc123?signature=xyz' }),
    expiresAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('UploadDownload');

registry.registerPath({
  method: 'post',
  path: apiPath('/uploads'),
  summary: 'Request a presigned upload URL for a declared purpose',
  tags: ['uploads'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateUploadRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Presigned upload URL issued',
      content: { 'application/json': { schema: CreateUploadResponseSchema } },
    },
    ...errorResponses([400, 401, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/uploads/{id}/complete'),
  summary: 'Confirm that a presigned upload has finished',
  tags: ['uploads'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Upload confirmed and queued for scanning',
      content: { 'application/json': { schema: UploadSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/uploads/{id}'),
  summary: 'Get the scan and processing status of an upload',
  tags: ['uploads'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The upload status',
      content: { 'application/json': { schema: UploadSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/uploads/{id}/download'),
  summary: 'Get a short-lived presigned download URL for a clean upload the caller may access',
  tags: ['uploads'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Presigned download URL issued',
      content: { 'application/json': { schema: UploadDownloadResponseSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});
