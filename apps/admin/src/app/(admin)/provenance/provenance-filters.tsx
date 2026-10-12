import { getTranslations } from 'next-intl/server';

import { PORTFOLIO_IMAGE_STATUSES, PROVENANCE_VERDICTS } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import type { ProvenanceFilters as ProvenanceFiltersValue } from './provenance-search-params';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export async function ProvenanceFilters({ status, verdict }: ProvenanceFiltersValue) {
  const t = await getTranslations('admin.provenance.list.filters');
  const tStatuses = await getTranslations('admin.provenance.statuses');
  const tVerdicts = await getTranslations('admin.provenance.verdicts');

  return (
    <form
      method="get"
      role="search"
      aria-label={t('formLabel')}
      className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="provenance-search-status">{t('statusLabel')}</Label>
        <select
          id="provenance-search-status"
          name="status"
          defaultValue={status}
          className={SELECT_CLASSNAME}
        >
          {PORTFOLIO_IMAGE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {tStatuses(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="provenance-search-verdict">{t('verdictLabel')}</Label>
        <select
          id="provenance-search-verdict"
          name="verdict"
          defaultValue={verdict ?? ''}
          className={SELECT_CLASSNAME}
        >
          <option value="">{t('allVerdicts')}</option>
          {PROVENANCE_VERDICTS.map((value) => (
            <option key={value} value={value}>
              {tVerdicts(value)}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit">{t('submit')}</Button>
    </form>
  );
}
