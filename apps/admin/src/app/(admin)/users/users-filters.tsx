import { getTranslations } from 'next-intl/server';

import { USER_ROLES, USER_STATUSES } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { UsersFilters as UsersFiltersValue } from './users-search-params';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

// A plain GET form: filtering works without client JS, and submitting it
// reloads /users with the new query string, which is what both the filter
// state and the DataTable remount key (see page.tsx) are derived from.
export async function UsersFilters({ q, role, status }: UsersFiltersValue) {
  const t = await getTranslations('admin.users.list.filters');
  const tRoles = await getTranslations('admin.users.roles');
  const tStatuses = await getTranslations('admin.users.statuses');

  return (
    <form
      method="get"
      role="search"
      aria-label={t('formLabel')}
      className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="flex flex-col gap-1.5 sm:min-w-64 sm:flex-1">
        <Label htmlFor="users-search-q">{t('searchLabel')}</Label>
        <Input id="users-search-q" name="q" defaultValue={q} placeholder={t('searchPlaceholder')} />
        <p className="text-xs text-muted-foreground">{t('searchHint')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="users-search-role">{t('roleLabel')}</Label>
        <select
          id="users-search-role"
          name="role"
          defaultValue={role ?? ''}
          className={SELECT_CLASSNAME}
        >
          <option value="">{t('allRoles')}</option>
          {USER_ROLES.map((value) => (
            <option key={value} value={value}>
              {tRoles(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="users-search-status">{t('statusLabel')}</Label>
        <select
          id="users-search-status"
          name="status"
          defaultValue={status ?? ''}
          className={SELECT_CLASSNAME}
        >
          <option value="">{t('allStatuses')}</option>
          {USER_STATUSES.map((value) => (
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
