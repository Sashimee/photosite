import type { components } from '@photoo/api-client';

type VerificationCase = components['schemas']['VerificationCase'];
type VerificationDocument = components['schemas']['VerificationDocument'];
type RequiredDocument = components['schemas']['RequiredDocument'];

// A case is safe to overwrite with a brand new one only once it's left the
// active set the API itself uses to block a second `create` (`draft`,
// `submitted`, `in_review` - verification.repository.ts `ACTIVE_CASE_STATUSES`).
// `approved` is technically outside that set too, but a verified
// photographer restarting verification isn't a flow this UI offers.
const RESTARTABLE_STATUSES: readonly VerificationCase['status'][] = ['rejected', 'expired'];

export function canStartNewVerificationCase(status: VerificationCase['status']): boolean {
  return RESTARTABLE_STATUSES.includes(status);
}

export interface VerificationBusinessFormValues {
  businessName: string;
  vatNumber: string;
  businessRegistrationNumber: string;
}

export const EMPTY_VERIFICATION_BUSINESS_FORM_VALUES: VerificationBusinessFormValues = {
  businessName: '',
  vatNumber: '',
  businessRegistrationNumber: '',
};

export function defaultVerificationBusinessFormValues(
  verificationCase: VerificationCase | null,
): VerificationBusinessFormValues {
  if (!verificationCase) {
    return EMPTY_VERIFICATION_BUSINESS_FORM_VALUES;
  }
  return {
    businessName: verificationCase.businessName ?? '',
    vatNumber: verificationCase.vatNumber ?? '',
    businessRegistrationNumber: verificationCase.businessRegistrationNumber ?? '',
  };
}

// The contract's fields are all optional but `min(1)` once present
// (packages/shared/src/contract/verification.ts), so a blank field is
// omitted entirely rather than sent as an empty string.
export function buildVerificationCasePayload(values: VerificationBusinessFormValues): {
  businessName?: string;
  vatNumber?: string;
  businessRegistrationNumber?: string;
} {
  const payload: {
    businessName?: string;
    vatNumber?: string;
    businessRegistrationNumber?: string;
  } = {};
  const businessName = values.businessName.trim();
  if (businessName) {
    payload.businessName = businessName;
  }
  const vatNumber = values.vatNumber.trim();
  if (vatNumber) {
    payload.vatNumber = vatNumber;
  }
  const businessRegistrationNumber = values.businessRegistrationNumber.trim();
  if (businessRegistrationNumber) {
    payload.businessRegistrationNumber = businessRegistrationNumber;
  }
  return payload;
}

export function mapVerificationIssuePath(
  path: readonly PropertyKey[],
): keyof VerificationBusinessFormValues | null {
  const [first] = path;
  return typeof first === 'string' && first in EMPTY_VERIFICATION_BUSINESS_FORM_VALUES
    ? (first as keyof VerificationBusinessFormValues)
    : null;
}

interface ValidationErrorDetail {
  path?: string;
  message?: string;
}

function isValidationErrorDetail(value: unknown): value is ValidationErrorDetail {
  return typeof value === 'object' && value !== null;
}

// The API's 400 VALIDATION_ERROR carries `details: [{ path: "businessName", ... }]`,
// a dot-joined string rather than the segment array zod itself uses (same
// convention as the photographer profile form's own helper).
export function mapValidationErrorDetailPath(
  details: unknown,
): (keyof VerificationBusinessFormValues | null)[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.map((detail) => {
    if (!isValidationErrorDetail(detail) || typeof detail.path !== 'string') {
      return null;
    }
    return mapVerificationIssuePath(detail.path.split('.'));
  });
}

export function findDocumentForKey(
  documents: readonly VerificationDocument[],
  key: string,
): VerificationDocument | null {
  return documents.find((document) => document.documentKey === key) ?? null;
}

function isRequirementSatisfied(documents: readonly VerificationDocument[], key: string): boolean {
  return findDocumentForKey(documents, key)?.virusScanStatus === 'clean';
}

// Mirrors the server's own submit() checks (verification.service.ts): a
// business name and a clean document for every required key. Used purely to
// disable the submit action client-side before the API has a chance to
// reject it with a 422 - the API remains the source of truth.
export function canSubmitVerificationCase(
  verificationCase: VerificationCase,
  requirements: readonly RequiredDocument[],
): boolean {
  if (verificationCase.status !== 'draft') {
    return false;
  }
  if (!verificationCase.businessName) {
    return false;
  }
  return requirements.every((requirement) =>
    isRequirementSatisfied(verificationCase.documents, requirement.key),
  );
}
