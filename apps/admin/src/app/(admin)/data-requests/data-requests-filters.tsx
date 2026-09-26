import { getTranslations } from 'next-intl/server';

import { DATA_REQUEST_CHANNELS, DATA_REQUEST_STATUSES, DATA_REQUEST_TYPES } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { DataRequestsFilters as DataRequestsFiltersValue } from './data-requests-search-params';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export async function DataRequestsFilters({
  status,
  type,
  channel,
  userId,
  userIdInvalid,
}: DataRequestsFiltersValue) {
  const t = await getTranslations('admin.dataRequests.list.filters');
  const tStatuses = await getTranslations('admin.dataRequests.statuses');
  const tTypes = await getTranslations('admin.dataRequests.types');
  const tChannels = await getTranslations('admin.dataRequests.channels');

  return (
    <form
      method="get"
      role="search"
      aria-label={t('formLabel')}
      className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="flex flex-col gap-1.5 sm:min-w-64 sm:flex-1">
        <Label htmlFor="data-requests-search-user-id">{t('userIdLabel')}</Label>
        <Input
          id="data-requests-search-user-id"
          name="userId"
          defaultValue={userId}
          placeholder={t('userIdPlaceholder')}
          aria-invalid={userIdInvalid ? true : undefined}
          aria-describedby={userIdInvalid ? 'data-requests-search-user-id-error' : undefined}
        />
        {userIdInvalid ? (
          <p
            id="data-requests-search-user-id-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {t('userIdInvalid')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="data-requests-search-type">{t('typeLabel')}</Label>
        <select
          id="data-requests-search-type"
          name="type"
          defaultValue={type ?? ''}
          className={SELECT_CLASSNAME}
        >
          <option value="">{t('allTypes')}</option>
          {DATA_REQUEST_TYPES.map((value) => (
            <option key={value} value={value}>
              {tTypes(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="data-requests-search-channel">{t('channelLabel')}</Label>
        <select
          id="data-requests-search-channel"
          name="channel"
          defaultValue={channel ?? ''}
          className={SELECT_CLASSNAME}
        >
          <option value="">{t('allChannels')}</option>
          {DATA_REQUEST_CHANNELS.map((value) => (
            <option key={value} value={value}>
              {tChannels(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="data-requests-search-status">{t('statusLabel')}</Label>
        <select
          id="data-requests-search-status"
          name="status"
          defaultValue={status ?? ''}
          className={SELECT_CLASSNAME}
        >
          <option value="">{t('allStatuses')}</option>
          {DATA_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {tStatuses(value)}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit">{t('submit')}</Button>
    </form>
  );
}
