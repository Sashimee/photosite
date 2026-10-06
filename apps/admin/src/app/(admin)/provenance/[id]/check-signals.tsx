import { getFormatter, getTranslations } from 'next-intl/server';

import type { components } from '@photoo/api-client';

import { CopyText } from './copy-text';

type AdminProvenanceCheck = components['schemas']['AdminProvenanceCheck'];

export async function CheckSignals({ check }: { check: AdminProvenanceCheck }) {
  const t = await getTranslations('admin.provenance.detail.signals');
  const tProvenance = await getTranslations('admin.provenance');
  const format = await getFormatter();
  const notChecked = tProvenance('notChecked');

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
      <dt className="text-muted-foreground">{t('aiScore')}</dt>
      <dd className="text-foreground">
        {check.aiScore === null ? notChecked : tProvenance('scoreValue', { score: check.aiScore })}
      </dd>

      <dt className="text-muted-foreground">{t('aiVendor')}</dt>
      <dd className="text-foreground">{check.aiVendor ?? notChecked}</dd>

      <dt className="text-muted-foreground">{t('reverseMatches')}</dt>
      <dd className="flex flex-col gap-2 text-foreground">
        {check.reverseMatches === null ? (
          notChecked
        ) : check.reverseMatches.length === 0 ? (
          t('reverseMatchesNone')
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('reverseMatchesHint')}</p>
            <ul className="flex flex-col gap-2">
              {check.reverseMatches.map((url) => (
                <li key={url}>
                  <CopyText value={url} />
                </li>
              ))}
            </ul>
          </>
        )}
      </dd>

      <dt className="text-muted-foreground">{t('c2paValid')}</dt>
      <dd className="text-foreground">
        {check.c2paValid === null
          ? notChecked
          : check.c2paValid
            ? t('c2paValidYes')
            : t('c2paValidNo')}
      </dd>

      <dt className="text-muted-foreground">{t('exifCamera')}</dt>
      <dd className="text-foreground">{check.exifCamera ?? t('exifMissing')}</dd>

      <dt className="text-muted-foreground">{t('exifCapturedAt')}</dt>
      <dd className="text-foreground">
        {check.exifCapturedAt
          ? format.dateTime(new Date(check.exifCapturedAt), 'medium')
          : t('exifMissing')}
      </dd>
    </dl>
  );
}
