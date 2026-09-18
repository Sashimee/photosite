import type { ConsentRecord } from '@photoo/db';
import { CONSENT_PURPOSES, ConsentRecordSchema, ConsentStateEntrySchema } from '@photoo/shared';
import type { z } from 'zod';

type ConsentStateEntry = z.infer<typeof ConsentStateEntrySchema>;

export function mapConsentRecord(record: ConsentRecord): z.infer<typeof ConsentRecordSchema> {
  return ConsentRecordSchema.parse({
    id: record.id,
    purpose: record.purpose,
    granted: record.granted,
    policyVersion: record.policyVersion,
    recordedAt: record.recordedAt.toISOString(),
  });
}

// Every purpose is always present (undecided ones as `granted: false`,
// `recordedAt: null`) so the client can render every toggle without
// special-casing a purpose that was never decided
// (contract/gdpr.ts `ConsentStateEntrySchema`).
export function buildConsentMatrix(
  records: readonly Pick<ConsentRecord, 'purpose' | 'granted' | 'policyVersion' | 'recordedAt'>[],
): ConsentStateEntry[] {
  const latestByPurpose = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    if (!latestByPurpose.has(record.purpose)) {
      latestByPurpose.set(record.purpose, record);
    }
  }

  return CONSENT_PURPOSES.map((purpose) => {
    const latest = latestByPurpose.get(purpose);
    return ConsentStateEntrySchema.parse(
      latest
        ? {
            purpose,
            granted: latest.granted,
            policyVersion: latest.policyVersion,
            recordedAt: latest.recordedAt.toISOString(),
          }
        : { purpose, granted: false, policyVersion: null, recordedAt: null },
    );
  });
}
