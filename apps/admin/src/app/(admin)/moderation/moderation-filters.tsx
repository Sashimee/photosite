import { getTranslations } from 'next-intl/server';

import { REPORT_STATUSES, REPORT_TARGET_TYPES } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import type { ModerationFilters as ModerationFiltersValue } from './moderation-search-params';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export async function ModerationFilters({ status, targetType }: ModerationFiltersValue) {
  const t = await getTranslations('admin.moderation.list.filters');
  const tStatuses = await getTranslations('admin.moderation.statuses');
  const tTargetTypes = await getTranslations('admin.moderation.targetTypes');

  return (
    <form
      method="get"
      role="search"
      aria-label={t('formLabel')}
      className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="moderation-search-status">{t('statusLabel')}</Label>
        <select
          id="moderation-search-status"
          name="status"
          defaultValue={status}
          className={SELECT_CLASSNAME}
        >
          {REPORT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {tStatuses(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="moderation-search-target-type">{t('targetTypeLabel')}</Label>
        <select
          id="moderation-search-target-type"
          name="targetType"
          defaultValue={targetType ?? ''}
          className={SELECT_CLASSNAME}
        >
          <option value="">{t('allTargetTypes')}</option>
          {REPORT_TARGET_TYPES.map((value) => (
            <option key={value} value={value}>
              {tTargetTypes(value)}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit">{t('submit')}</Button>
    </form>
  );
}
