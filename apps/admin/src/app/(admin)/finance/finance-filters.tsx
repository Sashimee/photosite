import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { ADMIN_BOOKING_DISPUTE_FILTERS, BOOKING_STATUSES } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { FinanceFilters as FinanceFiltersValue } from './finance-search-params';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export async function FinanceFilters({
  status,
  createdFrom,
  createdTo,
  dispute,
}: FinanceFiltersValue) {
  const t = await getTranslations('admin.finance.filters');
  const tStatuses = await getTranslations('admin.finance.statuses');

  return (
    <form
      method="get"
      role="search"
      aria-label={t('formLabel')}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">{t('statusLegend')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {BOOKING_STATUSES.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="status"
                value={value}
                defaultChecked={status?.includes(value) ?? false}
              />
              {tStatuses(value)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="finance-created-from">{t('createdFromLabel')}</Label>
          <Input
            id="finance-created-from"
            name="createdFrom"
            type="date"
            defaultValue={createdFrom ?? ''}
            aria-describedby="finance-created-hint"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="finance-created-to">{t('createdToLabel')}</Label>
          <Input
            id="finance-created-to"
            name="createdTo"
            type="date"
            defaultValue={createdTo ?? ''}
            aria-describedby="finance-created-hint"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="finance-dispute">{t('disputeLabel')}</Label>
          <select
            id="finance-dispute"
            name="dispute"
            defaultValue={dispute ?? ''}
            className={SELECT_CLASSNAME}
          >
            <option value="">{t('disputeAll')}</option>
            {ADMIN_BOOKING_DISPUTE_FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`dispute.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">{t('submit')}</Button>
        <Link
          href="/finance"
          className="inline-flex h-10 items-center text-sm underline-offset-4 hover:underline"
        >
          {t('clear')}
        </Link>
      </div>
      <p id="finance-created-hint" className="text-xs text-muted-foreground">
        {t('createdHint')}
      </p>
    </form>
  );
}
