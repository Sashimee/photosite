import type { components } from '@photoo/api-client';

type VerificationCase = components['schemas']['VerificationCase'];
type VerificationDocument = components['schemas']['VerificationDocument'];
type RequiredDocument = components['schemas']['RequiredDocument'];

const RESTARTABLE_STATUSES: readonly VerificationCase['status'][] = ['rejected', 'expired'];

export function canStartNewVerificationCase(status: VerificationCase['status']): boolean {
  return RESTARTABLE_STATUSES.includes(status);
}

export interface VerificationBusinessValues {
  businessName: string;
  vatNumber: string;
  businessRegistrationNumber: string;
}

export type VerificationBusinessErrors = Partial<Record<keyof VerificationBusinessValues, string>>;

export function valuesFromCase(
  verificationCase: VerificationCase | null,
): VerificationBusinessValues {
  return {
    businessName: verificationCase?.businessName ?? '',
    vatNumber: verificationCase?.vatNumber ?? '',
    businessRegistrationNumber: verificationCase?.businessRegistrationNumber ?? '',
  };
}

export function buildCasePayload(
  values: VerificationBusinessValues,
): Partial<VerificationBusinessValues> {
  const payload: Partial<VerificationBusinessValues> = {};
  for (const field of Object.keys(values) as (keyof VerificationBusinessValues)[]) {
    const trimmed = values[field].trim();
    if (trimmed) {
      payload[field] = trimmed;
    }
  }
  return payload;
}

export function mapCaseIssuePath(
  path: readonly PropertyKey[],
): keyof VerificationBusinessValues | null {
  const [first] = path;
  return typeof first === 'string' && first in valuesFromCase(null)
    ? (first as keyof VerificationBusinessValues)
    : null;
}

export function findDocumentForKey(
  documents: readonly VerificationDocument[],
  key: string,
): VerificationDocument | null {
  return documents.find((document) => document.documentKey === key) ?? null;
}

export function canSubmitVerificationCase(
  verificationCase: VerificationCase,
  requirements: readonly RequiredDocument[],
): boolean {
  if (verificationCase.status !== 'draft' || !verificationCase.businessName) {
    return false;
  }
  return requirements.every(
    (requirement) =>
      findDocumentForKey(verificationCase.documents, requirement.key)?.virusScanStatus === 'clean',
  );
}
