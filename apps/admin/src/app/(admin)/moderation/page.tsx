import { getTranslations } from 'next-intl/server';

import { ModerationFilters } from './moderation-filters';
import {
  moderationFiltersKey,
  parseModerationSearchParams,
  type RawModerationSearchParams,
} from './moderation-search-params';
import { ModerationTable } from './moderation-table';

export default async function ModerationQueuePage({
  searchParams,
}: {
  searchParams: Promise<RawModerationSearchParams>;
}) {
  const raw = await searchParams;
  const filters = parseModerationSearchParams(raw);
  const t = await getTranslations('admin.moderation.list');

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <ModerationFilters {...filters} />
      <ModerationTable key={moderationFiltersKey(filters)} {...filters} />
    </section>
  );
}
