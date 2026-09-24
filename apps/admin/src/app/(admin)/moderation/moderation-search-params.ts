import {
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  type ReportStatus,
  type ReportTargetType,
} from '@photoo/shared';

export type RawModerationSearchParams = Record<string, string | string[] | undefined>;

export interface ModerationFilters {
  status: ReportStatus;
  targetType?: ReportTargetType;
  moderatorInitiated?: boolean;
}

const DEFAULT_STATUS: ReportStatus = 'open';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value);
}

function isReportTargetType(value: string): value is ReportTargetType {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

// `open` is the default status filter, not a user preference: the queue is
// keyset-ordered oldest first with no sort param (AdminReportsRepository.list
// always orders by createdAt asc), and a queue that cannot show age silently
// starves its oldest item (docs/steps/1D.6-moderation.md).
export function parseModerationSearchParams(raw: RawModerationSearchParams): ModerationFilters {
  const rawStatus = first(raw.status);
  const status = rawStatus && isReportStatus(rawStatus) ? rawStatus : DEFAULT_STATUS;

  const rawTargetType = first(raw.targetType);
  const targetType = rawTargetType && isReportTargetType(rawTargetType) ? rawTargetType : undefined;

  const moderatorInitiated = first(raw.moderatorInitiated) === 'true';

  return {
    status,
    ...(targetType ? { targetType } : {}),
    ...(moderatorInitiated ? { moderatorInitiated } : {}),
  };
}

export function moderationFiltersKey(filters: ModerationFilters): string {
  return `${filters.status}|${filters.targetType ?? ''}|${filters.moderatorInitiated ? '1' : '0'}`;
}
