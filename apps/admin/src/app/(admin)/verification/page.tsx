import { getTranslations } from 'next-intl/server';

import { getSession } from '@/lib/server-api';

import { VerificationFilters } from './verification-filters';
import {
  parseVerificationSearchParams,
  verificationFiltersKey,
  type RawVerificationSearchParams,
} from './verification-search-params';
import { VerificationTable } from './verification-table';

export default async function VerificationQueuePage({
  searchParams,
}: {
  searchParams: Promise<RawVerificationSearchParams>;
}) {
  const raw = await searchParams;
  const filters = parseVerificationSearchParams(raw);
  const t = await getTranslations('admin.verification.list');

  const admin = await getSession();
  if (!admin) {
    throw new Error(
      'VerificationQueuePage rendered without a session; the (admin) layout should have redirected first',
    );
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <VerificationFilters {...filters} />
      <VerificationTable
        key={verificationFiltersKey(filters)}
        {...filters}
        currentAdminId={admin.id}
      />
    </section>
  );
}
