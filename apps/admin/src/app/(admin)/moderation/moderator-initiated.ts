import { MODERATOR_INITIATED_REPORT_REASON } from '@photoo/shared';

// `MODERATOR_INITIATED_REPORT_REASON` is a fixed sentinel the API writes for
// a report it synthesised from a direct takedown (D25, docs/DECISIONS.md),
// not text a reporter typed. Every other `reason` value is attacker-controlled
// and stays rendered as plain text (docs/steps/1D.6-moderation.md); this is
// the one exact-match exception, never a substring or case-insensitive check.
export function isModeratorInitiatedReport(reason: string): boolean {
  return reason === MODERATOR_INITIATED_REPORT_REASON;
}
