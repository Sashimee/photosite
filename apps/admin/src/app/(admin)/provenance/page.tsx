import { getTranslations } from 'next-intl/server';

import { ProvenanceFilters } from './provenance-filters';
import {
  parseProvenanceSearchParams,
  provenanceFiltersKey,
  type RawProvenanceSearchParams,
} from './provenance-search-params';
import { ProvenanceTable } from './provenance-table';

export default async function ProvenanceQueuePage({
  searchParams,
}: {
  searchParams: Promise<RawProvenanceSearchParams>;
}) {
  const raw = await searchParams;
  const filters = parseProvenanceSearchParams(raw);
  const t = await getTranslations('admin.provenance.list');

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <ProvenanceFilters {...filters} />
      <ProvenanceTable key={provenanceFiltersKey(filters)} {...filters} />
    </section>
  );
}
