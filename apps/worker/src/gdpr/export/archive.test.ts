import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readZipEntries, type ZipEntry } from '../../testing/read-zip.js';
import { writeZipArchive, type ArchiveStorage } from './archive.js';

function requireEntry(entries: ZipEntry[], name: string): ZipEntry {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`zip is missing ${name}`);
  }
  return entry;
}

function fakeStorage(objects: Record<string, Buffer>): {
  storage: ArchiveStorage;
  uploaded: () => Buffer;
} {
  let uploaded = Buffer.alloc(0);
  const storage: ArchiveStorage = {
    config: { privateBucket: 'private' },
    getObjectStream: (_bucket, key) =>
      Promise.resolve(Readable.from([objects[key] ?? Buffer.alloc(0)])),
    putObjectStream: async (input) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) {
        chunks.push(chunk as Buffer);
      }
      uploaded = Buffer.concat(chunks);
    },
  };
  return { storage, uploaded: () => uploaded };
}

describe('writeZipArchive', () => {
  it('writes json, text and binary entries into one streamed zip', async () => {
    const { storage, uploaded } = fakeStorage({ 'key/one.jpg': Buffer.from('image-bytes') });

    await writeZipArchive({
      storage,
      bucket: 'private',
      key: 'gdpr-exports/req-1.zip',
      jsonFiles: { 'manifest.json': { ok: true } },
      textFiles: { 'README.txt': 'hello' },
      binaryFiles: [{ arcPath: 'files/one.jpg', bucket: 'private', objectKey: 'key/one.jpg' }],
    });

    const entries = await readZipEntries(uploaded());
    const names = entries.map((entry) => entry.name).sort();
    expect(names).toEqual(['README.txt', 'files/one.jpg', 'manifest.json']);

    const manifest = requireEntry(entries, 'manifest.json');
    expect(JSON.parse(manifest.content.toString('utf8'))).toEqual({ ok: true });

    const binary = requireEntry(entries, 'files/one.jpg');
    expect(binary.content.toString('utf8')).toBe('image-bytes');
  });

  it('rejects when a binary file cannot be read from storage', async () => {
    const storage: ArchiveStorage = {
      config: { privateBucket: 'private' },
      getObjectStream: () => Promise.reject(new Error('object not found')),
      putObjectStream: () => Promise.resolve(),
    };

    await expect(
      writeZipArchive({
        storage,
        bucket: 'private',
        key: 'gdpr-exports/req-2.zip',
        jsonFiles: {},
        textFiles: {},
        binaryFiles: [{ arcPath: 'files/missing.jpg', bucket: 'private', objectKey: 'missing' }],
      }),
    ).rejects.toThrow('object not found');
  });
});
