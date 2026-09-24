export interface ApplyFormValues {
  message: string;
  portfolioLink: string;
}

export const EMPTY_APPLY_FORM_VALUES: ApplyFormValues = {
  message: '',
  portfolioLink: '',
};

// `portfolioLink` is sent as `null` rather than omitted when left blank, the
// same convention as `buildProfessionalProfilePayload` for `website`: this
// is an update-shaped field even though applications are create-only, and it
// keeps `exactOptionalPropertyTypes` happy without a conditional key.
export function buildApplyPayload(values: ApplyFormValues): {
  message: string;
  portfolioLink: string | null;
} {
  return {
    message: values.message.trim(),
    portfolioLink: values.portfolioLink.trim() || null,
  };
}

export type ApplyFormFieldPath = keyof ApplyFormValues;

export function mapApplyIssuePath(path: readonly PropertyKey[]): ApplyFormFieldPath | null {
  const [first] = path;
  return typeof first === 'string' && first in EMPTY_APPLY_FORM_VALUES
    ? (first as ApplyFormFieldPath)
    : null;
}

interface ValidationErrorDetail {
  path?: string;
  message?: string;
}

function isValidationErrorDetail(value: unknown): value is ValidationErrorDetail {
  return typeof value === 'object' && value !== null;
}

// The API's 400 VALIDATION_ERROR carries `details: [{ path: "message", ... }]`,
// a dot-joined string rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(details: unknown): (ApplyFormFieldPath | null)[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.map((detail) => {
    if (!isValidationErrorDetail(detail) || typeof detail.path !== 'string') {
      return null;
    }
    return mapApplyIssuePath(detail.path.split('.'));
  });
}
