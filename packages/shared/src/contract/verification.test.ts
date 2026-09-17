import { describe, expect, it } from 'vitest';
import {
  AdminVerificationCaseSchema,
  AdminVerificationCaseSummarySchema,
  AdminVerificationDocumentSchema,
  AttachVerificationDocumentRequestSchema,
  CreateVerificationCaseRequestSchema,
  RequiredDocumentSchema,
  UpdateVerificationCaseRequestSchema,
  VerificationCaseSchema,
  VerificationDocumentSchema,
} from './verification.js';

const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const validDocument = {
  id,
  documentKey: 'id_card',
  mimeType: 'application/pdf',
  virusScanStatus: 'clean',
  uploadedAt: '2026-09-16T12:00:00.000Z',
};

const validCase = {
  id,
  countryCode: 'LU',
  status: 'submitted',
  businessName: 'Jane Doe Photography SARL',
  vatNumber: 'LU12345678',
  businessRegistrationNumber: 'B123456',
  documents: [validDocument],
  submittedAt: '2026-09-16T12:00:00.000Z',
  decidedAt: null,
  rejectionReason: null,
};

describe('RequiredDocumentSchema', () => {
  it('accepts a well-formed required document', () => {
    expect(
      RequiredDocumentSchema.safeParse({
        key: 'id_card',
        label: { en: 'Government-issued ID' },
        description: 'A valid passport or national ID card',
        acceptedMimeTypes: ['image/jpeg', 'application/pdf'],
      }).success,
    ).toBe(true);
  });

  it('rejects an empty acceptedMimeTypes list', () => {
    expect(
      RequiredDocumentSchema.safeParse({
        key: 'id_card',
        label: { en: 'Government-issued ID' },
        description: null,
        acceptedMimeTypes: [],
      }).success,
    ).toBe(false);
  });
});

describe('VerificationCaseSchema', () => {
  it('accepts a well-formed case', () => {
    expect(VerificationCaseSchema.safeParse(validCase).success).toBe(true);
  });

  it('never exposes a document storageKey', () => {
    expect(
      VerificationCaseSchema.safeParse({
        ...validCase,
        documents: [{ ...validDocument, storageKey: 'verification/abc123.pdf' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a decidedByAdminId field', () => {
    expect(VerificationCaseSchema.safeParse({ ...validCase, decidedByAdminId: id }).success).toBe(
      false,
    );
  });

  it('rejects an unknown status', () => {
    expect(VerificationCaseSchema.safeParse({ ...validCase, status: 'archived' }).success).toBe(
      false,
    );
  });

  it('rejects a rejectionReason longer than 1000 characters', () => {
    expect(
      VerificationCaseSchema.safeParse({ ...validCase, rejectionReason: 'a'.repeat(1001) }).success,
    ).toBe(false);
  });
});

const validAdminCase = {
  ...validCase,
  userId: id,
  assignedAdminId: null,
  decidedByAdminId: null,
};

const validAdminCaseSummary = {
  id,
  countryCode: 'LU',
  status: 'submitted',
  documents: [validDocument],
  submittedAt: '2026-09-16T12:00:00.000Z',
  decidedAt: null,
  rejectionReason: null,
  userId: id,
  assignedAdminId: null,
  decidedByAdminId: null,
  photographer: { displayName: 'Jane Doe', email: 'jane@example.com' },
};

describe('AdminVerificationCaseSummarySchema', () => {
  it('accepts a well-formed admin case with the photographer identity, no business fields', () => {
    expect(AdminVerificationCaseSummarySchema.safeParse(validAdminCaseSummary).success).toBe(true);
  });

  it('rejects a businessName field', () => {
    expect(
      AdminVerificationCaseSummarySchema.safeParse({
        ...validAdminCaseSummary,
        businessName: 'Jane Doe Photography SARL',
      }).success,
    ).toBe(false);
  });

  it('rejects a document carrying a downloadUrl', () => {
    expect(
      AdminVerificationCaseSummarySchema.safeParse({
        ...validAdminCaseSummary,
        documents: [{ ...validDocument, downloadUrl: 'https://example.com/doc.pdf' }],
      }).success,
    ).toBe(false);
  });
});

describe('AdminVerificationCaseSchema', () => {
  it('accepts a document with no downloadUrl (not yet scanned clean)', () => {
    expect(
      AdminVerificationCaseSchema.safeParse({
        ...validAdminCase,
        documents: [validDocument],
      }).success,
    ).toBe(true);
  });

  it('accepts a document with a presigned downloadUrl', () => {
    expect(
      AdminVerificationCaseSchema.safeParse({
        ...validAdminCase,
        documents: [{ ...validDocument, downloadUrl: 'https://example.com/doc.pdf' }],
      }).success,
    ).toBe(true);
  });

  it('rejects a photographer field: only the summary carries it', () => {
    expect(
      AdminVerificationCaseSchema.safeParse({
        ...validAdminCase,
        photographer: { displayName: 'Jane Doe', email: 'jane@example.com' },
      }).success,
    ).toBe(false);
  });
});

describe('AdminVerificationDocumentSchema', () => {
  it('accepts a document with no downloadUrl', () => {
    expect(AdminVerificationDocumentSchema.safeParse(validDocument).success).toBe(true);
  });

  it('rejects an invalid downloadUrl when present', () => {
    expect(
      AdminVerificationDocumentSchema.safeParse({ ...validDocument, downloadUrl: 'not-a-url' })
        .success,
    ).toBe(false);
  });
});

describe('VerificationDocumentSchema', () => {
  it('accepts a well-formed document', () => {
    expect(VerificationDocumentSchema.safeParse(validDocument).success).toBe(true);
  });

  it('rejects a storageKey field', () => {
    expect(
      VerificationDocumentSchema.safeParse({ ...validDocument, storageKey: 'abc' }).success,
    ).toBe(false);
  });
});

describe('CreateVerificationCaseRequestSchema', () => {
  it('accepts an empty body: the country comes from the caller profile, never the client', () => {
    expect(CreateVerificationCaseRequestSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a countryCode field', () => {
    expect(CreateVerificationCaseRequestSchema.safeParse({ countryCode: 'LU' }).success).toBe(
      false,
    );
  });

  it('rejects a request carrying a status field', () => {
    expect(
      CreateVerificationCaseRequestSchema.safeParse({
        businessName: 'Jane Doe',
        status: 'approved',
      }).success,
    ).toBe(false);
  });
});

describe('UpdateVerificationCaseRequestSchema', () => {
  it('accepts a partial update without a countryCode', () => {
    expect(
      UpdateVerificationCaseRequestSchema.safeParse({ businessName: 'New name' }).success,
    ).toBe(true);
  });

  it('rejects a countryCode field', () => {
    expect(UpdateVerificationCaseRequestSchema.safeParse({ countryCode: 'LU' }).success).toBe(
      false,
    );
  });
});

describe('AttachVerificationDocumentRequestSchema', () => {
  it('requires an uploadId and documentKey', () => {
    expect(
      AttachVerificationDocumentRequestSchema.safeParse({ uploadId: id, documentKey: 'id_card' })
        .success,
    ).toBe(true);
  });

  it('rejects a request carrying a storageKey', () => {
    expect(
      AttachVerificationDocumentRequestSchema.safeParse({
        uploadId: id,
        documentKey: 'id_card',
        storageKey: 'abc',
      }).success,
    ).toBe(false);
  });
});
