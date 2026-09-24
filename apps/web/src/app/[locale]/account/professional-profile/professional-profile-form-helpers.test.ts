import { describe, expect, it } from 'vitest';

import {
  buildProfessionalProfilePayload,
  defaultValuesFromProfessionalProfile,
  EMPTY_PROFESSIONAL_PROFILE_FORM_VALUES,
  mapProfessionalProfileIssuePath,
  mapValidationErrorDetailPath,
} from './professional-profile-form-helpers';

describe('defaultValuesFromProfessionalProfile', () => {
  it('returns empty values when there is no profile yet', () => {
    expect(defaultValuesFromProfessionalProfile(null)).toEqual(
      EMPTY_PROFESSIONAL_PROFILE_FORM_VALUES,
    );
  });

  it('defaults a null website and vatNumber to an empty string', () => {
    const defaults = defaultValuesFromProfessionalProfile({
      id: 'p1',
      companyName: 'Acme',
      website: null,
      logoUrl: null,
      verified: false,
      vatNumber: null,
    });

    expect(defaults).toEqual({ companyName: 'Acme', website: '', vatNumber: '' });
  });

  it('carries an existing website and vatNumber through', () => {
    const defaults = defaultValuesFromProfessionalProfile({
      id: 'p1',
      companyName: 'Acme',
      website: 'https://acme.example',
      logoUrl: 'https://cdn.example/logo.png',
      verified: true,
      vatNumber: 'LU12345678',
    });

    expect(defaults).toEqual({
      companyName: 'Acme',
      website: 'https://acme.example',
      vatNumber: 'LU12345678',
    });
  });
});

describe('buildProfessionalProfilePayload', () => {
  const values = { companyName: '  Acme  ', website: '  ', vatNumber: '  LU1  ' };

  it('trims companyName and vatNumber, and turns a blank website into null', () => {
    const payload = buildProfessionalProfilePayload(values, undefined);
    expect(payload).toEqual({ companyName: 'Acme', website: null, vatNumber: 'LU1' });
  });

  it('omits logoUploadId entirely when it was never touched', () => {
    const payload = buildProfessionalProfilePayload(values, undefined);
    expect('logoUploadId' in payload).toBe(false);
  });

  it('includes a new logoUploadId when a logo was uploaded', () => {
    const payload = buildProfessionalProfilePayload(values, 'upload-1');
    expect(payload.logoUploadId).toBe('upload-1');
  });

  it('includes an explicit null logoUploadId when the logo was removed', () => {
    const payload = buildProfessionalProfilePayload(values, null);
    expect(payload).toHaveProperty('logoUploadId', null);
  });
});

describe('mapProfessionalProfileIssuePath', () => {
  it('maps a known top-level field', () => {
    expect(mapProfessionalProfileIssuePath(['companyName'])).toBe('companyName');
    expect(mapProfessionalProfileIssuePath(['website'])).toBe('website');
  });

  it('maps an unknown path to null', () => {
    expect(mapProfessionalProfileIssuePath(['logoUploadId'])).toBeNull();
    expect(mapProfessionalProfileIssuePath([])).toBeNull();
  });
});

describe('mapValidationErrorDetailPath', () => {
  it('maps dot-joined server detail paths the same way as client issues', () => {
    expect(
      mapValidationErrorDetailPath([
        { path: 'companyName', message: 'Invalid' },
        { path: 'website' },
      ]),
    ).toEqual(['companyName', 'website']);
  });

  it('returns an empty array for non-array details', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
  });
});
