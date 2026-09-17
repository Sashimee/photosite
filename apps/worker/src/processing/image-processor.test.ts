import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_VARIANT_WIDTHS,
  MagicByteMismatchError,
  PixelLimitExceededError,
  processImage,
} from './image-processor.js';

const EXIF = {
  IFD0: { Make: 'TestCam', Model: 'X100' },
  IFD2: { DateTimeOriginal: '2026:01:01 12:00:00' },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '49/1 36/1 4200/100',
    GPSLongitudeRef: 'E',
    GPSLongitude: '6/1 7/1 5500/100',
  },
};

async function jpegWithGps(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .withExif(EXIF)
    .jpeg()
    .toBuffer();
}

describe('processImage', () => {
  it('extracts camera, capture time and GPS, and renders 3 sizes x 2 formats without metadata', async () => {
    const buffer = await jpegWithGps();
    const result = await processImage({
      buffer,
      declaredMimeType: 'image/jpeg',
      maxPixels: 100_000_000,
    });

    expect(result.exif.camera).toEqual({ make: 'TestCam', model: 'X100' });
    expect(result.exif.capturedAt).toBe('2026-01-01T11:00:00.000Z');
    expect(result.exif.gps?.latitude).toBeCloseTo(49.611_666_67, 5);
    expect(result.exif.gps?.longitude).toBeCloseTo(6.131_944_44, 5);

    expect(result.variants).toHaveLength(Object.keys(IMAGE_VARIANT_WIDTHS).length * 2);
    const keys = new Set(result.variants.map((variant) => variant.key));
    expect(keys.size).toBe(result.variants.length);

    for (const variant of result.variants) {
      const metadata = await sharp(variant.buffer).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.format).toBe(variant.format === 'jpeg' ? 'jpeg' : 'webp');
      expect(metadata.width).toBeLessThanOrEqual(IMAGE_VARIANT_WIDTHS[variant.name]);
    }
  });

  it('does not upscale an image smaller than a variant width', async () => {
    const buffer = await jpegWithGps(100, 80);
    const result = await processImage({
      buffer,
      declaredMimeType: 'image/jpeg',
      maxPixels: 100_000_000,
    });

    const large = result.variants.find(
      (variant) => variant.name === 'large' && variant.format === 'jpeg',
    );
    const metadata = await sharp(large?.buffer).metadata();
    expect(metadata.width).toBe(100);
  });

  it('rejects a magic-byte mismatch against the declared mime type', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
      .png()
      .toBuffer();

    await expect(
      processImage({ buffer: png, declaredMimeType: 'image/jpeg', maxPixels: 100_000_000 }),
    ).rejects.toThrow(MagicByteMismatchError);
  });

  it('rejects an image over the configured pixel limit', async () => {
    const buffer = await jpegWithGps(200, 200);

    await expect(
      processImage({ buffer, declaredMimeType: 'image/jpeg', maxPixels: 100 }),
    ).rejects.toThrow(PixelLimitExceededError);
  });
});
