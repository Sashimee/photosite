import { getTranslations } from 'next-intl/server';

import { DataRequestsFilters } from './data-requests-filters';
import {
  dataRequestsFiltersKey,
  parseDataRequestsSearchParams,
  type RawDataRequestsSearchParams,
} from './data-requests-search-params';
import { DataRequestsTable } from './data-requests-table';

export default async function DataRequestsPage({
  searchParams,
}: {
  searchParams: Promise<RawDataRequestsSearchParams>;
}) {
  const raw = await searchParams;
  const filters = parseDataRequestsSearchParams(raw);
  const t = await getTranslations('admin.dataRequests.list');

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('verificationDocumentsNote')}</p>
      <DataRequestsFilters {...filters} />
      <DataRequestsTable key={dataRequestsFiltersKey(filters)} {...filters} />
    </section>
  );
}
