import {
  PORTFOLIO_IMAGE_STATUSES,
  PROVENANCE_VERDICTS,
  type PortfolioImageStatus,
  type ProvenanceVerdict,
} from '@photoo/shared';

export type RawProvenanceSearchParams = Record<string, string | string[] | undefined>;

export interface ProvenanceFilters {
  status: PortfolioImageStatus;
  verdict?: ProvenanceVerdict;
}

const DEFAULT_STATUS: PortfolioImageStatus = 'pending_review';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isImageStatus(value: string): value is PortfolioImageStatus {
  return (PORTFOLIO_IMAGE_STATUSES as readonly string[]).includes(value);
}

function isVerdict(value: string): value is ProvenanceVerdict {
  return (PROVENANCE_VERDICTS as readonly string[]).includes(value);
}

// `pending_review` is the default status filter, not a user preference: a
// queue sorted newest-first starves the photographer who has waited longest
// (docs/steps/1D.4-provenance-queue.md). The API always orders oldest first,
// so there is no sort param here.
export function parseProvenanceSearchParams(raw: RawProvenanceSearchParams): ProvenanceFilters {
  const rawStatus = first(raw.status);
  const rawVerdict = first(raw.verdict);

  return {
    status: rawStatus && isImageStatus(rawStatus) ? rawStatus : DEFAULT_STATUS,
    ...(rawVerdict && isVerdict(rawVerdict) ? { verdict: rawVerdict } : {}),
  };
}

export function provenanceFiltersKey(filters: ProvenanceFilters): string {
  return `${filters.status}|${filters.verdict ?? ''}`;
}
