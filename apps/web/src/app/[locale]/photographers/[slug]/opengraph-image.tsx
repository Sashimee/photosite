import { getTranslations } from 'next-intl/server';
import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';

import { DEFAULT_LOCALE, isLocale, type Locale } from '@photoo/shared';

import { loadProfile } from './page';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: requestedLocale, slug } = await params;
  const locale: Locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;

  const result = await loadProfile(slug);
  if (!result) {
    notFound();
  }
  const { profile } = result;

  const tCategories = await getTranslations({ locale, namespace: 'common.categories' });
  const categories = profile.categories.map((category) => tCategories(category)).join(' · ');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#ffffff',
        padding: 80,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontSize: 32, fontWeight: 600, color: '#1a1a1a' }}>Photoo</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 64, fontWeight: 700, color: '#1a1a1a' }}>{profile.displayName}</div>
        <div style={{ fontSize: 32, color: '#737373' }}>{profile.city}</div>
        {categories ? <div style={{ fontSize: 28, color: '#737373' }}>{categories}</div> : null}
      </div>
    </div>,
    size,
  );
}
