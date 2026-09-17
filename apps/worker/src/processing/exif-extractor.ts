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
  latitude?: unknown;
  longitude?: unknown;
}

// Only camera/capture-time/GPS ever leave this function: the rest of a raw
// EXIF blob (serial numbers, software strings, thumbnails) never needs to
// exist as structured data at all, private field or not.
export async function extractExif(buffer: Buffer): Promise<ExtractedExif> {
  const empty: ExtractedExif = { camera: null, capturedAt: null, gps: null };
  const data = (await exifr
    .parse(buffer, { gps: true, exif: true, tiff: true, translateValues: true })
    .catch(() => null)) as ParsedExif | null;

  if (!data) {
    return empty;
  }

  const make = typeof data.Make === 'string' ? data.Make : null;
  const model = typeof data.Model === 'string' ? data.Model : null;
  const camera = make || model ? { make, model } : null;

  const capturedAt =
    data.DateTimeOriginal instanceof Date ? data.DateTimeOriginal.toISOString() : null;

  const gps =
    typeof data.latitude === 'number' && typeof data.longitude === 'number'
      ? { latitude: data.latitude, longitude: data.longitude }
      : null;

  return { camera, capturedAt, gps };
}
