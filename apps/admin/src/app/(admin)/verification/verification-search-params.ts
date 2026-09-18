import {
  CountryCodeSchema,
  VERIFICATION_CASE_STATUSES,
  type VerificationCaseStatus,
} from '@photoo/shared';

export type RawVerificationSearchParams = Record<string, string | string[] | undefined>;

export interface VerificationFilters {
  status: VerificationCaseStatus;
  countryCode?: string;
}

const DEFAULT_STATUS: VerificationCaseStatus = 'submitted';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isVerificationStatus(value: string): value is VerificationCaseStatus {
  return (VERIFICATION_CASE_STATUSES as readonly string[]).includes(value);
}

// `submitted` is the default status filter, not a user preference: a queue
// sorted newest-first starves the oldest applicant (docs/steps/1D.3
// -verification-queue.md). The API itself always orders by submittedAt
// ascending, so there is no sort param here.
export function parseVerificationSearchParams(
  raw: RawVerificationSearchParams,
): VerificationFilters {
  const rawStatus = first(raw.status);
  const status = rawStatus && isVerificationStatus(rawStatus) ? rawStatus : DEFAULT_STATUS;

  const rawCountry = first(raw.countryCode)?.trim().toUpperCase();
  const countryCode =
    rawCountry && CountryCodeSchema.safeParse(rawCountry).success ? rawCountry : undefined;

  return {
    status,
    ...(countryCode ? { countryCode } : {}),
  };
}

export function verificationFiltersKey(filters: VerificationFilters): string {
  return `${filters.status}|${filters.countryCode ?? ''}`;
}
