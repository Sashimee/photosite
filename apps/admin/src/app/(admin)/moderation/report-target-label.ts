import type { components } from '@photoo/api-client';

import type { TranslateFn } from '@/lib/auth-errors';

type AdminReportTarget = NonNullable<components['schemas']['AdminReport']['target']>;

// A human-readable name for the reported content, for the takedown dialog's
// confirmation (docs/steps/1D.6-moderation.md: "confirmed, names the
// target") and the queue table. `t` is scoped to `admin.moderation.detail`.
// Only `photographer_profile`, `request` and `job_offer` have a name of
// their own; the other two fall back to a description of the content.
export function reportTargetLabel(t: TranslateFn, target: AdminReportTarget): string {
  switch (target.targetType) {
    case 'photographer_profile':
      return target.displayName;
    case 'request':
      return target.title;
    case 'job_offer':
      return target.title;
    case 'portfolio_image':
      return t('target.portfolioImage.label');
    case 'job_application':
      return t('target.jobApplication.label', { jobOfferTitle: target.jobOfferTitle });
  }
}
