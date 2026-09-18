import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { DEFAULT_LOCALE } from '@photoo/shared';

import '@/styles/globals.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.meta');
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const messages = await getMessages();

  return (
    <html lang={DEFAULT_LOCALE}>
      <body>
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
