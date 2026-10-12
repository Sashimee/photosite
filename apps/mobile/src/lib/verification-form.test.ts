import { describe, expect, it } from '@jest/globals';

import {
  buildCasePayload,
  canStartNewVerificationCase,
  canSubmitVerificationCase,
  mapCaseIssuePath,
} from './verification-form';

const requirements = [
  { key: 'id_card', label: {}, description: null, acceptedMimeTypes: ['image/jpeg'] },
  { key: 'vat', label: {}, description: null, acceptedMimeTypes: ['application/pdf'] },
];

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    countryCode: 'LU',
    status: 'draft',
    documents: [],
    submittedAt: null,
    decidedAt: null,
    rejectionReason: null,
    businessName: 'Studio',
    vatNumber: null,
    businessRegistrationNumber: null,
    ...overrides,
  } as never;
}

const clean = (documentKey: string) => ({
  id: documentKey,
  documentKey,
  mimeType: 'image/jpeg',
  virusScanStatus: 'clean',
  uploadedAt: '2026-10-01T10:00:00.000Z',
});

describe('canSubmitVerificationCase', () => {
  it('requires a clean document for every required key', () => {
    expect(canSubmitVerificationCase(makeCase(), requirements)).toBe(false);
    expect(
      canSubmitVerificationCase(makeCase({ documents: [clean('id_card')] }), requirements),
    ).toBe(false);
    expect(
      canSubmitVerificationCase(
        makeCase({
          documents: [clean('id_card'), { ...clean('vat'), virusScanStatus: 'pending' }],
        }),
        requirements,
      ),
    ).toBe(false);
    expect(
      canSubmitVerificationCase(
        makeCase({ documents: [clean('id_card'), clean('vat')] }),
        requirements,
      ),
    ).toBe(true);
  });

  it('requires a business name and a draft case', () => {
    const documents = [clean('id_card'), clean('vat')];
    expect(
      canSubmitVerificationCase(makeCase({ documents, businessName: null }), requirements),
    ).toBe(false);
    expect(
      canSubmitVerificationCase(makeCase({ documents, status: 'submitted' }), requirements),
    ).toBe(false);
  });
});

describe('buildCasePayload', () => {
  it('omits blank fields and trims the rest', () => {
    expect(
      buildCasePayload({
        businessName: ' Studio ',
        vatNumber: '  ',
        businessRegistrationNumber: '',
      }),
    ).toEqual({ businessName: 'Studio' });
  });
});

describe('helpers', () => {
  it('only lets rejected and expired cases be restarted', () => {
    expect(canStartNewVerificationCase('rejected')).toBe(true);
    expect(canStartNewVerificationCase('expired')).toBe(true);
    expect(canStartNewVerificationCase('approved')).toBe(false);
    expect(canStartNewVerificationCase('draft')).toBe(false);
  });

  it('maps known issue paths only', () => {
    expect(mapCaseIssuePath(['vatNumber'])).toBe('vatNumber');
    expect(mapCaseIssuePath(['other'])).toBeNull();
  });
});
