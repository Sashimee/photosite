import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { extractExif } from './exif-extractor.js';

describe('extractExif', () => {
  it('returns all-null fields when the image has no EXIF at all', async () => {
    const buffer = await sharp({
      create: { width: 5, height: 5, channels: 3, background: 'green' },
    })
      .jpeg()
      .toBuffer();

    expect(await extractExif(buffer)).toEqual({ camera: null, capturedAt: null, gps: null });
  });

  it('reports a camera with only a Make set and no capture time or GPS', async () => {
    const buffer = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'blue' } })
      .withExif({ IFD0: { Make: 'OnlyMake' } })
      .jpeg()
      .toBuffer();

    expect(await extractExif(buffer)).toEqual({
      camera: { make: 'OnlyMake', model: null },
      capturedAt: null,
      gps: null,
    });
  });

  it('returns all-null fields instead of throwing when the buffer is not a real image', async () => {
    const result = await extractExif(Buffer.from('not an image'));
    expect(result).toEqual({ camera: null, capturedAt: null, gps: null });
  });

  it('reports a camera with only a Model set when Make is not a usable string', async () => {
    vi.doMock('exifr', () => ({
      default: { parse: vi.fn().mockResolvedValue({ Make: 123, Model: 'OnlyModel' }) },
    }));
    vi.resetModules();
    const { extractExif: mockedExtractExif } = await import('./exif-extractor.js');

    expect(await mockedExtractExif(Buffer.from('irrelevant'))).toEqual({
      camera: { make: null, model: 'OnlyModel' },
      capturedAt: null,
      gps: null,
    });

    vi.doUnmock('exifr');
    vi.resetModules();
  });
});
