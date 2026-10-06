import { getTranslations } from 'next-intl/server';

import { BookingsTable } from './bookings-table';

export default async function FinancePage() {
  const t = await getTranslations('admin.finance');

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <BookingsTable />
    </section>
  );
}
