import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { IdSchema, isLocale, type Locale } from '@photoo/shared';

import { BookingDetail } from '@/components/requests/booking-detail';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';
import { absoluteUrl } from '@/lib/site-url';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.bookings.detail' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: requestedLocale, id } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  if (!IdSchema.safeParse(id).success) {
    notFound();
  }
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/bookings/${id}`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, result] = await Promise.all([
    getTranslations({ locale, namespace: 'web.bookings.detail' }),
    api.GET('/v1/bookings/{id}', { params: { path: { id } }, cache: 'no-store' }),
  ]);

  if (result.response.status === 401) {
    redirect(signInHref);
  }
  if (result.response.status === 404 || result.response.status === 403) {
    notFound();
  }
  if (!result.data) {
    throw new Error(`Failed to load booking "${id}": HTTP ${String(result.response.status)}`);
  }
  const booking = result.data;
  if (booking.clientId !== user.id) {
    notFound();
  }

  return (
    <BookingDetail
      booking={booking}
      locale={locale}
      backHref={`/${locale}/bookings`}
      backLabel={t('backToList')}
      checkoutReturnUrl={absoluteUrl(locale, `/bookings/${booking.id}`)}
    />
  );
}
