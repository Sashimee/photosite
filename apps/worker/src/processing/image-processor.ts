import { randomBytes } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp, { type Metadata } from 'sharp';
import { extractExif, type ExtractedExif } from './exif-extractor.js';

export const IMAGE_VARIANT_WIDTHS = { thumb: 320, medium: 1280, large: 2560 } as const;

export type ImageVariantName = keyof typeof IMAGE_VARIANT_WIDTHS;
export type ImageVariantFormat = 'jpeg' | 'webp';

export class MagicByteMismatchError extends Error {}

export class PixelLimitExceededError extends Error {}

export interface ProcessImageInput {
  buffer: Buffer;
  declaredMimeType: string;
  maxPixels: number;
}

export interface ImageVariantFile {
  name: ImageVariantName;
  format: ImageVariantFormat;
  key: string;
  buffer: Buffer;
}

export interface ProcessImageResult {
  exif: ExtractedExif;
  variants: ImageVariantFile[];
  width: number;
  height: number;
}

const JPEG_QUALITY = 82;
const WEBP_QUALITY = 80;

function variantKey(token: string, name: ImageVariantName, format: ImageVariantFormat): string {
  const extension = format === 'jpeg' ? 'jpg' : 'webp';
  return `v/${token}/${name}.${extension}`;
}

async function renderVariant(
  buffer: Buffer,
  maxPixels: number,
  width: number,
  format: ImageVariantFormat,
): Promise<Buffer> {
  const pipeline = sharp(buffer, { limitInputPixels: maxPixels })
    .rotate()
    .resize({ width, fit: 'inside', withoutEnlargement: true });
  return format === 'jpeg'
    ? pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer()
    : pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
}

// Public-bucket variant paths get a fresh random token instead of reusing
// the upload/owner id, so a v7 UUID's time-ordering can never be used to
// guess another user's variant URLs once these are served publicly.
export async function processImage(input: ProcessImageInput): Promise<ProcessImageResult> {
  const detected = await fileTypeFromBuffer(input.buffer);
  if (detected?.mime !== input.declaredMimeType) {
    throw new MagicByteMismatchError(
      `declared mime type ${input.declaredMimeType} does not match detected ${detected?.mime ?? 'unknown'}`,
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input.buffer, { limitInputPixels: input.maxPixels }).metadata();
  } catch {
    throw new PixelLimitExceededError(
      `image exceeds the ${String(input.maxPixels)} pixel limit or could not be decoded`,
    );
  }
  const { width, height } = metadata.autoOrient;

  const exif = await extractExif(input.buffer);
  const token = randomBytes(16).toString('hex');

  const variants: ImageVariantFile[] = [];
  for (const [name, width] of Object.entries(IMAGE_VARIANT_WIDTHS) as [
    ImageVariantName,
    number,
  ][]) {
    for (const format of ['jpeg', 'webp'] as const) {
      const rendered = await renderVariant(input.buffer, input.maxPixels, width, format);
      variants.push({ name, format, key: variantKey(token, name, format), buffer: rendered });
    }
  }

  return { exif, variants, width, height };
}
