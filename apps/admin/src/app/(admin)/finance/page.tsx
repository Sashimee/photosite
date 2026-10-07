import { getTranslations } from 'next-intl/server';

import { BookingsTable } from './bookings-table';
import { ExportButton } from './export-button';
import { FinanceFilters } from './finance-filters';
import {
  financeFiltersKey,
  parseFinanceSearchParams,
  type RawFinanceSearchParams,
} from './finance-search-params';

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<RawFinanceSearchParams>;
}) {
  const filters = parseFinanceSearchParams(await searchParams);
  const t = await getTranslations('admin.finance');

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <FinanceFilters {...filters} />
      <ExportButton {...filters} />
      <BookingsTable key={financeFiltersKey(filters)} {...filters} />
    </section>
  );
}
