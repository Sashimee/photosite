import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <Link
          href="/moderation/direct-takedown"
          className="text-sm underline-offset-4 hover:underline"
        >
          {t('directTakedownLink')}
        </Link>
      </div>
      <ModerationFilters {...filters} />
      <ModerationTable key={moderationFiltersKey(filters)} {...filters} />
    </section>
  );
}
