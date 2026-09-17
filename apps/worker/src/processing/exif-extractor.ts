import exifr from 'exifr';

export interface ExtractedExif {
  camera: { make: string | null; model: string | null } | null;
  capturedAt: string | null;
  gps: { latitude: number; longitude: number } | null;
}

interface ParsedExif {
  Make?: unknown;
  Model?: unknown;
  DateTimeOriginal?: unknown;
  OffsetTimeOriginal?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

// Only camera/capture-time/GPS ever leave this function: the rest of a raw
// EXIF blob (serial numbers, software strings, thumbnails) never needs to
// exist as structured data at all, private field or not.
export async function extractExif(buffer: Buffer): Promise<ExtractedExif> {
  const empty: ExtractedExif = { camera: null, capturedAt: null, gps: null };
  const data = (await exifr
    .parse(buffer, {
      gps: true,
      exif: true,
      tiff: true,
      translateValues: true,
      reviveValues: false,
    })
    .catch(() => null)) as ParsedExif | null;

  if (!data) {
    return empty;
  }

  const make = typeof data.Make === 'string' ? data.Make : null;
  const model = typeof data.Model === 'string' ? data.Model : null;
  const camera = make || model ? { make, model } : null;

  const capturedAt = toCapturedAt(data.DateTimeOriginal, data.OffsetTimeOriginal);

  const gps =
    typeof data.latitude === 'number' && typeof data.longitude === 'number'
      ? { latitude: data.latitude, longitude: data.longitude }
      : null;

  return { camera, capturedAt, gps };
}

const EXIF_DATE_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const EXIF_OFFSET = /^[+-]\d{2}:\d{2}$/;

// EXIF DateTimeOriginal is camera wall-clock time with no zone; converting it
// with the worker's timezone would make the stored value depend on the host.
function toCapturedAt(dateTime: unknown, offset: unknown): string | null {
  if (typeof dateTime !== 'string' || !EXIF_DATE_TIME.test(dateTime.trim())) {
    return null;
  }
  const wallClock = dateTime.trim().replace(EXIF_DATE_TIME, '$1-$2-$3T$4:$5:$6');
  const zone = typeof offset === 'string' && EXIF_OFFSET.test(offset.trim()) ? offset.trim() : '';
  return wallClock + zone;
}
