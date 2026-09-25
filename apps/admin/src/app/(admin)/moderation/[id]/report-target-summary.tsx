import { getFormatter, getTranslations } from 'next-intl/server';

import type { components } from '@photoo/api-client';
import { REPORT_TARGET_TYPES } from '@photoo/shared';

type AdminReportTarget = NonNullable<components['schemas']['AdminReport']['target']>;

function isKnownTargetType(value: string): value is (typeof REPORT_TARGET_TYPES)[number] {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

// Renders exactly the fields the API hands back for each target type
// (docs/steps/1D.6-moderation.md: "a summary, not the row") - never an
// owner's email or other users' data, because the API never sends one here.
// An anonymised profile (`slug: deleted-{id}`, `displayName: 'Deleted user'`)
// is rendered exactly as any other one; special-casing it would hide that
// the anonymisation happened.
export async function ReportTargetSummary({
  targetType,
  target,
}: {
  targetType: string;
  target: AdminReportTarget | null;
}) {
  const t = await getTranslations('admin.moderation.detail.target');
  const format = await getFormatter();
  const tTargetTypes = await getTranslations('admin.moderation.targetTypes');
  const tImageStatuses = await getTranslations('admin.moderation.portfolioImageStatuses');
  const targetTypeLabel = isKnownTargetType(targetType) ? tTargetTypes(targetType) : targetType;

  if (!target) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {targetTypeLabel}
        </p>
        <p className="text-sm font-medium text-foreground">{t('removed.title')}</p>
        <p className="text-sm text-muted-foreground">{t('removed.description')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      {target.deletedAt ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('alreadyTakenDown', {
            date: format.dateTime(new Date(target.deletedAt), 'medium'),
          })}
        </p>
      ) : null}

      {target.targetType === 'photographer_profile' ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('photographerProfile.displayName')}</dt>
          <dd className="text-foreground">{target.displayName}</dd>
          <dt className="text-muted-foreground">{t('photographerProfile.slug')}</dt>
          <dd className="font-mono text-foreground">{target.slug}</dd>
          <dt className="text-muted-foreground">{t('photographerProfile.isPublished')}</dt>
          <dd className="text-foreground">
            {target.isPublished
              ? t('photographerProfile.published')
              : t('photographerProfile.unpublished')}
          </dd>
        </dl>
      ) : null}

      {target.targetType === 'portfolio_image' ? (
        <div className="flex flex-col gap-3">
          {target.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a public portfolio URL from the API's own S3_PUBLIC_BASE_URL, not the admin app's origin next/image is configured for.
            <img
              src={target.url}
              alt={t('portfolioImage.alt')}
              referrerPolicy="no-referrer"
              loading="lazy"
              className="max-h-[60vh] w-full max-w-md rounded-md border border-border object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('portfolioImage.noPreview')}</p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('portfolioImage.dimensions')}</dt>
            <dd className="text-foreground">
              {target.width && target.height
                ? t('portfolioImage.dimensionsValue', {
                    width: target.width,
                    height: target.height,
                  })
                : t('portfolioImage.dimensionsUnknown')}
            </dd>
            <dt className="text-muted-foreground">{t('portfolioImage.status')}</dt>
            <dd className="text-foreground">{tImageStatuses(target.status)}</dd>
          </dl>
        </div>
      ) : null}

      {target.targetType === 'request' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{target.title}</p>
          <p className="text-sm whitespace-pre-wrap text-foreground">{target.description}</p>
        </div>
      ) : null}

      {target.targetType === 'job_offer' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{target.title}</p>
          <p className="text-sm text-muted-foreground">
            {t('jobOffer.companyName', { companyName: target.companyName })}
          </p>
          <p className="text-sm whitespace-pre-wrap text-foreground">{target.description}</p>
        </div>
      ) : null}

      {target.targetType === 'job_application' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {t('jobApplication.jobOfferTitle', { jobOfferTitle: target.jobOfferTitle })}
          </p>
          <p className="text-sm whitespace-pre-wrap text-foreground">
            {target.message || t('jobApplication.emptyMessage')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
