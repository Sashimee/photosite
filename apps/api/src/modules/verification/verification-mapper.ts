import type { Upload, VerificationCase, VerificationDocument } from '@photoo/db';
import {
  AdminVerificationCaseSchema,
  AdminVerificationCaseSummarySchema,
  VerificationCaseSchema,
} from '@photoo/shared';
import type { z } from 'zod';

export type VerificationDocumentWithUpload = VerificationDocument & { upload: Upload };
export type VerificationCaseWithDocuments = VerificationCase & {
  documents: VerificationDocumentWithUpload[];
};

export interface DecryptedVerificationFields {
  businessName: string | null;
  vatNumber: string | null;
  businessRegistrationNumber: string | null;
}

export interface VerificationPhotographerIdentity {
  displayName: string;
  email: string;
}

export function isDocumentDownloadable(upload: Upload): boolean {
  return (
    upload.virusScanStatus === 'clean' &&
    (upload.status === 'clean' || upload.status === 'processed')
  );
}

function mapDocument(document: VerificationDocumentWithUpload) {
  return {
    id: document.id,
    documentKey: document.documentKey,
    mimeType: document.upload.mimeType,
    virusScanStatus: document.upload.virusScanStatus,
    uploadedAt: document.createdAt.toISOString(),
  };
}

export function mapVerificationCase(
  row: VerificationCaseWithDocuments,
  decrypted: DecryptedVerificationFields,
): z.infer<typeof VerificationCaseSchema> {
  return VerificationCaseSchema.parse({
    id: row.id,
    countryCode: row.countryCode,
    status: row.status,
    businessName: decrypted.businessName,
    vatNumber: decrypted.vatNumber,
    businessRegistrationNumber: decrypted.businessRegistrationNumber,
    documents: row.documents.map(mapDocument),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
  });
}

export function mapAdminVerificationCaseSummary(
  row: VerificationCaseWithDocuments,
  photographer: VerificationPhotographerIdentity,
): z.infer<typeof AdminVerificationCaseSummarySchema> {
  return AdminVerificationCaseSummarySchema.parse({
    id: row.id,
    userId: row.userId,
    countryCode: row.countryCode,
    status: row.status,
    assignedAdminId: row.assignedAdminId,
    decidedByAdminId: row.decidedByAdminId,
    photographer,
    documents: row.documents.map(mapDocument),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
  });
}

export function mapAdminVerificationCase(
  row: VerificationCaseWithDocuments,
  decrypted: DecryptedVerificationFields,
  downloadUrls: ReadonlyMap<string, string>,
): z.infer<typeof AdminVerificationCaseSchema> {
  return AdminVerificationCaseSchema.parse({
    id: row.id,
    userId: row.userId,
    countryCode: row.countryCode,
    status: row.status,
    businessName: decrypted.businessName,
    vatNumber: decrypted.vatNumber,
    businessRegistrationNumber: decrypted.businessRegistrationNumber,
    assignedAdminId: row.assignedAdminId,
    decidedByAdminId: row.decidedByAdminId,
    documents: row.documents.map((document) => {
      const downloadUrl = downloadUrls.get(document.id);
      return downloadUrl ? { ...mapDocument(document), downloadUrl } : mapDocument(document);
    }),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
  });
}
