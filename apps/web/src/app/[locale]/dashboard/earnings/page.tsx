import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { FormNotice } from '@/components/ui/form-message';
import { formatMoney } from '@/lib/money';
import { requestErrorMessage } from '@/lib/request-errors';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.earnings' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function DashboardEarningsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/earnings`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const t = await getTranslations({ locale, namespace: 'web.dashboard.earnings' });

  const result = await api.GET('/v1/me/earnings', { cache: 'no-store' });
  const status = result.response.status;
  if (status === 401) {
    redirect(signInHref);
  }
  if (status !== 200 && status !== 403 && status !== 429) {
    throw new Error(`Failed to load your earnings: HTTP ${String(status)}`);
  }

  const backLink = (
    <Link
      href={`/${locale}/dashboard`}
      className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {t('backToOverview')}
    </Link>
  );
  const heading = (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-muted-foreground">{t('intro')}</p>
    </div>
  );

  if (!result.data) {
    return (
      <div className="flex flex-col gap-8">
        {backLink}
        {heading}
        <FormNotice tone="error">{requestErrorMessage(t, result.error)}</FormNotice>
      </div>
    );
  }

  const { totals, recent } = result.data;

  return (
    <div className="flex flex-col gap-8">
      {backLink}
      {heading}

      {totals.length === 0 && recent.length === 0 ? (
        <FormNotice tone="info">
          <p className="font-medium">{t('emptyTitle')}</p>
          <p>{t('emptyDescription')}</p>
        </FormNotice>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {totals.map((total) => (
              <li
                key={total.currency}
                className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">{t('releasedLabel')}</span>
                  <span className="text-xl font-semibold text-foreground">
                    {formatMoney(
                      { amountCents: total.releasedCents, currency: total.currency },
                      locale,
                    )}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">{t('heldLabel')}</span>
                  <span className="text-xl font-semibold text-foreground">
                    {formatMoney(
                      { amountCents: total.heldCents, currency: total.currency },
                      locale,
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-sm text-muted-foreground">{t('payoutSchedule')}</p>

          {recent.length > 0 ? (
            <section className="flex flex-col gap-3" aria-labelledby="earnings-recent-heading">
              <h2 id="earnings-recent-heading" className="text-lg font-semibold text-foreground">
                {t('recentHeading')}
              </h2>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {recent.map((entry) => (
                  <li
                    key={entry.bookingId}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      <FormattedDateTime value={entry.occurredAt} locale={locale} />
                    </span>
                    <span className="font-medium text-foreground">
                      {formatMoney(
                        { amountCents: entry.amountCents, currency: entry.currency },
                        locale,
                      )}
                    </span>
                    <Link
                      href={`/${locale}/dashboard/bookings/${entry.bookingId}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t('recentLink')}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
