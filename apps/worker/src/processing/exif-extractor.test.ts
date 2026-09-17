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
  it('keeps the capture time as camera wall-clock time and appends the EXIF offset when present', async () => {
    const buffer = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'red' } })
      .withExif({
        IFD2: { DateTimeOriginal: '2026:07:14 09:30:05', OffsetTimeOriginal: '+02:00' },
      })
      .jpeg()
      .toBuffer();

    expect((await extractExif(buffer)).capturedAt).toBe('2026-07-14T09:30:05+02:00');
  });

  it('drops a malformed capture time instead of guessing', async () => {
    vi.doMock('exifr', () => ({
      default: {
        parse: vi
          .fn()
          .mockResolvedValue({ DateTimeOriginal: '0000:00:00', OffsetTimeOriginal: 'x' }),
      },
    }));
    vi.resetModules();
    const { extractExif: mockedExtractExif } = await import('./exif-extractor.js');

    expect((await mockedExtractExif(Buffer.from('irrelevant'))).capturedAt).toBeNull();

    vi.doUnmock('exifr');
    vi.resetModules();
  });
});
