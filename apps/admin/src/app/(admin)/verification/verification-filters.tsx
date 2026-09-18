import { getTranslations } from 'next-intl/server';

import { VERIFICATION_CASE_STATUSES } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { VerificationFilters as VerificationFiltersValue } from './verification-search-params';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export async function VerificationFilters({ status, countryCode }: VerificationFiltersValue) {
  const t = await getTranslations('admin.verification.list.filters');
  const tStatuses = await getTranslations('admin.verification.statuses');

  return (
    <form
      method="get"
      role="search"
      aria-label={t('formLabel')}
      className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verification-search-status">{t('statusLabel')}</Label>
        <select
          id="verification-search-status"
          name="status"
          defaultValue={status}
          className={SELECT_CLASSNAME}
        >
          {VERIFICATION_CASE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {tStatuses(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verification-search-country">{t('countryLabel')}</Label>
        <Input
          id="verification-search-country"
          name="countryCode"
          defaultValue={countryCode}
          placeholder={t('countryPlaceholder')}
          className="w-24 uppercase"
          maxLength={2}
        />
        <p className="text-xs text-muted-foreground">{t('countryHint')}</p>
      </div>

      <Button type="submit">{t('submit')}</Button>
    </form>
  );
}
