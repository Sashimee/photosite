import { fromBuffer } from 'yauzl-promise';

export interface ZipEntry {
  name: string;
  content: Buffer;
}

// Test-only: unzips a whole archive into memory so a test can search across
// every entry at once ("assert on the whole zip, not per file",
// docs/steps/1A.12-gdpr.md), never used by production code.
export async function readZipEntries(buffer: Buffer): Promise<ZipEntry[]> {
  const zip = await fromBuffer(buffer);
  const entries: ZipEntry[] = [];
  try {
    for await (const entry of zip) {
      const stream = await entry.openReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      entries.push({ name: entry.filename, content: Buffer.concat(chunks) });
    }
  } finally {
    await zip.close();
  }
  return entries;
}
