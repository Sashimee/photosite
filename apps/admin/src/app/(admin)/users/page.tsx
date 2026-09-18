import { getTranslations } from 'next-intl/server';

import { UsersFilters } from './users-filters';
import {
  parseUsersSearchParams,
  usersFiltersKey,
  type RawUsersSearchParams,
} from './users-search-params';
import { UsersTable } from './users-table';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<RawUsersSearchParams>;
}) {
  const raw = await searchParams;
  const filters = parseUsersSearchParams(raw);
  const t = await getTranslations('admin.users.list');

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <UsersFilters {...filters} />
      <UsersTable key={usersFiltersKey(filters)} {...filters} />
    </section>
  );
}
