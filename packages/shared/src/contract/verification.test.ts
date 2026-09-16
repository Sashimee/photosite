import { describe, expect, it } from 'vitest';
import {
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
  it('accepts a country code only', () => {
    expect(CreateVerificationCaseRequestSchema.safeParse({ countryCode: 'LU' }).success).toBe(true);
  });

  it('rejects a request carrying a status field', () => {
    expect(
      CreateVerificationCaseRequestSchema.safeParse({ countryCode: 'LU', status: 'approved' })
        .success,
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
