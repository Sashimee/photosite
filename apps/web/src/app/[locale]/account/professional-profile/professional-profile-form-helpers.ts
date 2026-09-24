import type { components } from '@photoo/api-client';

type OwnProfessionalProfile = components['schemas']['OwnProfessionalProfile'];

export interface ProfessionalProfileFormValues {
  companyName: string;
  website: string;
  vatNumber: string;
}

export const EMPTY_PROFESSIONAL_PROFILE_FORM_VALUES: ProfessionalProfileFormValues = {
  companyName: '',
  website: '',
  vatNumber: '',
};

export function defaultValuesFromProfessionalProfile(
  profile: OwnProfessionalProfile | null,
): ProfessionalProfileFormValues {
  if (!profile) {
    return EMPTY_PROFESSIONAL_PROFILE_FORM_VALUES;
  }
  return {
    companyName: profile.companyName,
    website: profile.website ?? '',
    vatNumber: profile.vatNumber ?? '',
  };
}

// `logoUploadId` is omitted from the payload entirely (not sent as
// `undefined`) when the logo wasn't touched, so an edit that only changes
// `companyName` leaves the existing logo alone rather than clearing it -
// `undefined` and "key absent" mean the same thing to the API, but only the
// latter is compatible with `exactOptionalPropertyTypes` once this object is
// sent as the request body.
export function buildProfessionalProfilePayload(
  values: ProfessionalProfileFormValues,
  logoUploadId: string | null | undefined,
) {
  return {
    companyName: values.companyName.trim(),
    website: values.website.trim() || null,
    vatNumber: values.vatNumber.trim() || null,
    ...(logoUploadId !== undefined ? { logoUploadId } : {}),
  };
}

export function mapProfessionalProfileIssuePath(
  path: readonly PropertyKey[],
): keyof ProfessionalProfileFormValues | null {
  const [first] = path;
  return typeof first === 'string' && first in EMPTY_PROFESSIONAL_PROFILE_FORM_VALUES
    ? (first as keyof ProfessionalProfileFormValues)
    : null;
}

interface ValidationErrorDetail {
  path?: string;
  message?: string;
}

function isValidationErrorDetail(value: unknown): value is ValidationErrorDetail {
  return typeof value === 'object' && value !== null;
}

// The API's 400 VALIDATION_ERROR carries `details: [{ path: "companyName", ... }]`,
// a dot-joined string rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(
  details: unknown,
): (keyof ProfessionalProfileFormValues | null)[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.map((detail) => {
    if (!isValidationErrorDetail(detail) || typeof detail.path !== 'string') {
      return null;
    }
    return mapProfessionalProfileIssuePath(detail.path.split('.'));
  });
}
