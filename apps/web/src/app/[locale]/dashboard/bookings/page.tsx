import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { BookingCard } from '@/components/requests/booking-card';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

const DASHBOARD_BOOKINGS_LIMIT = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.bookings' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function DashboardBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const { cursor } = await searchParams;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/bookings`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, profileResult, result] = await Promise.all([
    getTranslations({ locale, namespace: 'web.dashboard.bookings' }),
    api.GET('/v1/me/photographer-profile', { cache: 'no-store' }),
    api.GET('/v1/bookings', {
      params: { query: { limit: DASHBOARD_BOOKINGS_LIMIT, ...(cursor ? { cursor } : {}) } },
      cache: 'no-store',
    }),
  ]);

  if (result.response.status === 401 || profileResult.response.status === 401) {
    redirect(signInHref);
  }
  if (profileResult.response.status !== 200 && profileResult.response.status !== 404) {
    throw new Error(
      `Failed to load the photographer profile: HTTP ${String(profileResult.response.status)}`,
    );
  }
  if (!result.data) {
    throw new Error(`Failed to load your bookings: HTTP ${String(result.response.status)}`);
  }

  // `GET /bookings` has no client/photographer filter, so this page - the
  // photographer-facing one - only shows bookings where the signed-in user's
  // own photographer profile is the one being booked; /bookings shows the
  // client side of the same list. Without a profile, none of the bookings
  // can be this photographer's, so the list is simply empty.
  const profileId = profileResult.data?.id;
  const items = result.data.items.filter((booking) => booking.photographerId === profileId);

  return (
    <div className="flex flex-col gap-8">
      <Link
        href={`/${locale}/dashboard`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToOverview')}
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              locale={locale}
              basePath={`/${locale}/dashboard/bookings`}
            />
          ))}
        </ul>
      )}

      {result.data.nextCursor ? (
        <Link
          href={`/${locale}/dashboard/bookings?cursor=${encodeURIComponent(result.data.nextCursor)}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </div>
  );
}
