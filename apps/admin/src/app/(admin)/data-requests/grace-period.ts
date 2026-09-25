const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_PERIOD_DAYS = 30;

// Mirrors apps/worker/src/gdpr/sweep/anonymise-deletions.ts's GRACE_PERIOD_MS;
// there is no API field for the deadline, so it is derived here. Rounds up
// (Math.ceil), unlike reportAgeDays' Math.floor, so a deletion still pending
// with hours left doesn't read as "0 days left". Clamped to zero both for a
// deadline the sweep hasn't enforced yet (sweep lag) and for a `requestedAt`
// in the future (clock skew).
export function graceDaysRemaining(requestedAt: string, now: Date = new Date()): number {
  const deadlineMs = new Date(requestedAt).getTime() + GRACE_PERIOD_DAYS * DAY_MS;
  const remainingMs = deadlineMs - now.getTime();
  return Math.max(0, Math.ceil(remainingMs / DAY_MS));
}
