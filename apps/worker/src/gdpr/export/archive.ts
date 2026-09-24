import { PassThrough, type Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import type { ExportBinaryFile } from './collect.js';

export interface ArchiveStorage {
  config: { privateBucket: string };
  getObjectStream(bucket: string, key: string): Promise<Readable>;
  putObjectStream(input: {
    bucket: string;
    key: string;
    body: Readable;
    contentType: string;
  }): Promise<void>;
}

export interface WriteArchiveInput {
  storage: ArchiveStorage;
  bucket: string;
  key: string;
  jsonFiles: Record<string, unknown>;
  textFiles: Record<string, string>;
  binaryFiles: ExportBinaryFile[];
}

// Streams straight into the S3 multipart upload (docs/steps/1A.12-gdpr.md
// "the worker streams it ... one entity at a time"): every binary file is
// opened as a private-bucket read stream and piped into the archive one at
// a time, so only one image is ever in flight, and the finished zip itself
// is never buffered in memory or on local disk.
export async function writeZipArchive(input: WriteArchiveInput): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  // No `.file()`/`.directory()`/`.glob()` calls happen here (every entry is
  // a string, a buffer or an already-open stream), so archiver has nothing
  // to stat on disk and never has a benign ENOENT warning to filter out:
  // any `warning` here is as real as an `error`.
  const archiveFailure = new Promise<never>((_resolve, reject) => {
    const fail = (error: Error) => {
      passthrough.destroy(error);
      reject(error);
    };
    archive.on('error', fail);
    archive.on('warning', fail);
  });
  archiveFailure.catch(() => undefined);

  const uploadDone = input.storage.putObjectStream({
    bucket: input.bucket,
    key: input.key,
    body: passthrough,
    contentType: 'application/zip',
  });
  uploadDone.catch(() => undefined);

  for (const [name, content] of Object.entries(input.textFiles)) {
    archive.append(content, { name });
  }
  for (const [name, data] of Object.entries(input.jsonFiles)) {
    archive.append(JSON.stringify(data, null, 2), { name });
  }
  for (const file of input.binaryFiles) {
    const stream = await input.storage.getObjectStream(
      input.storage.config.privateBucket,
      file.objectKey,
    );
    archive.append(stream, { name: file.arcPath });
    await new Promise<void>((resolve, reject) => {
      stream.once('end', resolve);
      stream.once('error', reject);
    });
  }

  const finalized = archive.finalize().then(() => uploadDone);
  await Promise.race([finalized, archiveFailure]);
}
