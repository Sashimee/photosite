import { GDPR_DELETION_GRACE_PERIOD_MS } from '@photoo/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

// There is no API field for the deadline, so it is derived here. Rounds up
// (Math.ceil), unlike reportAgeDays' Math.floor, so a deletion still pending
// with hours left doesn't read as "0 days left". Clamped to zero for a
// deadline the sweep hasn't enforced yet (sweep lag).
export function graceDaysRemaining(requestedAt: string, now: Date = new Date()): number {
  const deadlineMs = new Date(requestedAt).getTime() + GDPR_DELETION_GRACE_PERIOD_MS;
  const remainingMs = deadlineMs - now.getTime();
  return Math.max(0, Math.ceil(remainingMs / DAY_MS));
}

// The admin has no visibility into the worker's GDPR_SWEEP_INTERVAL_MS, so a
// flat one-day slack is used instead: it comfortably covers the default
// hourly sweep plus one missed run before a still-pending deletion is flagged
// overdue rather than merely "due now".
const OVERDUE_SLACK_MS = DAY_MS;

export function isOverdueDeletion(
  requestedAt: string,
  failureReason: string | null,
  now: Date = new Date(),
): boolean {
  if (failureReason !== null) {
    return true;
  }
  const deadlineMs = new Date(requestedAt).getTime() + GDPR_DELETION_GRACE_PERIOD_MS;
  return now.getTime() > deadlineMs + OVERDUE_SLACK_MS;
}
