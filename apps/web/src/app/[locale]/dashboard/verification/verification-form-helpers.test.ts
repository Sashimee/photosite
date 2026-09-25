import { describe, expect, it } from 'vitest';

import type { components } from '@photoo/api-client';

import {
  buildVerificationCasePayload,
  canStartNewVerificationCase,
  canSubmitVerificationCase,
  defaultVerificationBusinessFormValues,
  EMPTY_VERIFICATION_BUSINESS_FORM_VALUES,
  findDocumentForKey,
  mapValidationErrorDetailPath,
  mapVerificationIssuePath,
} from './verification-form-helpers';

type VerificationCase = components['schemas']['VerificationCase'];
type VerificationDocument = components['schemas']['VerificationDocument'];

function verificationCase(overrides: Partial<VerificationCase> = {}): VerificationCase {
  return {
    id: 'case-1',
    countryCode: 'LU',
    status: 'draft',
    documents: [],
    submittedAt: null,
    decidedAt: null,
    rejectionReason: null,
    businessName: null,
    vatNumber: null,
    businessRegistrationNumber: null,
    ...overrides,
  };
}

function document(overrides: Partial<VerificationDocument> = {}): VerificationDocument {
  return {
    id: 'doc-1',
    documentKey: 'id_card',
    mimeType: 'application/pdf',
    virusScanStatus: 'clean',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('canStartNewVerificationCase', () => {
  it('allows starting again from rejected and expired', () => {
    expect(canStartNewVerificationCase('rejected')).toBe(true);
    expect(canStartNewVerificationCase('expired')).toBe(true);
  });

  it('refuses everywhere else, including approved', () => {
    expect(canStartNewVerificationCase('draft')).toBe(false);
    expect(canStartNewVerificationCase('submitted')).toBe(false);
    expect(canStartNewVerificationCase('in_review')).toBe(false);
    expect(canStartNewVerificationCase('approved')).toBe(false);
  });
});

describe('defaultVerificationBusinessFormValues', () => {
  it('returns empty values when there is no case yet', () => {
    expect(defaultVerificationBusinessFormValues(null)).toEqual(
      EMPTY_VERIFICATION_BUSINESS_FORM_VALUES,
    );
  });

  it('fills values from the existing case, defaulting nulls to empty strings', () => {
    expect(
      defaultVerificationBusinessFormValues(
        verificationCase({
          businessName: 'Acme',
          vatNumber: null,
          businessRegistrationNumber: 'RC123',
        }),
      ),
    ).toEqual({ businessName: 'Acme', vatNumber: '', businessRegistrationNumber: 'RC123' });
  });
});

describe('buildVerificationCasePayload', () => {
  it('omits blank fields instead of sending an empty string', () => {
    expect(
      buildVerificationCasePayload({
        businessName: '  Acme  ',
        vatNumber: '',
        businessRegistrationNumber: '   ',
      }),
    ).toEqual({ businessName: 'Acme' });
  });

  it('includes every trimmed field when all are filled in', () => {
    expect(
      buildVerificationCasePayload({
        businessName: 'Acme',
        vatNumber: 'LU12345',
        businessRegistrationNumber: 'RC123',
      }),
    ).toEqual({ businessName: 'Acme', vatNumber: 'LU12345', businessRegistrationNumber: 'RC123' });
  });
});

describe('mapVerificationIssuePath / mapValidationErrorDetailPath', () => {
  it('maps a known field path', () => {
    expect(mapVerificationIssuePath(['businessName'])).toBe('businessName');
  });

  it('maps an unknown field path to null', () => {
    expect(mapVerificationIssuePath(['countryCode'])).toBeNull();
  });

  it('maps dot-joined API validation detail paths', () => {
    expect(
      mapValidationErrorDetailPath([{ path: 'vatNumber' }, { path: 'unknownField' }, {}]),
    ).toEqual(['vatNumber', null, null]);
  });

  it('returns an empty array for non-array details', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
  });
});

describe('findDocumentForKey', () => {
  it('finds the document matching the key', () => {
    const idCard = document({ documentKey: 'id_card' });
    expect(
      findDocumentForKey([document({ documentKey: 'proof_of_address' }), idCard], 'id_card'),
    ).toBe(idCard);
  });

  it('returns null when no document matches', () => {
    expect(findDocumentForKey([], 'id_card')).toBeNull();
  });
});

describe('canSubmitVerificationCase', () => {
  const requirements: components['schemas']['RequiredDocument'][] = [
    {
      key: 'id_card',
      label: { en: 'ID card' },
      description: null,
      acceptedMimeTypes: ['application/pdf'],
    },
    {
      key: 'proof_of_address',
      label: { en: 'Proof of address' },
      description: null,
      acceptedMimeTypes: ['application/pdf'],
    },
  ];

  it('refuses when the case is not a draft', () => {
    expect(
      canSubmitVerificationCase(
        verificationCase({ status: 'submitted', businessName: 'Acme' }),
        [],
      ),
    ).toBe(false);
  });

  it('refuses without a business name', () => {
    expect(canSubmitVerificationCase(verificationCase({ businessName: null }), [])).toBe(false);
  });

  it('refuses when a required document is missing', () => {
    expect(
      canSubmitVerificationCase(
        verificationCase({
          businessName: 'Acme',
          documents: [document({ documentKey: 'id_card' })],
        }),
        requirements,
      ),
    ).toBe(false);
  });

  it('refuses when a required document has not scanned clean yet', () => {
    expect(
      canSubmitVerificationCase(
        verificationCase({
          businessName: 'Acme',
          documents: [
            document({ documentKey: 'id_card' }),
            document({ documentKey: 'proof_of_address', virusScanStatus: 'pending' }),
          ],
        }),
        requirements,
      ),
    ).toBe(false);
  });

  it('allows submitting once every requirement has a clean document', () => {
    expect(
      canSubmitVerificationCase(
        verificationCase({
          businessName: 'Acme',
          documents: [
            document({ documentKey: 'id_card' }),
            document({ documentKey: 'proof_of_address' }),
          ],
        }),
        requirements,
      ),
    ).toBe(true);
  });
});
