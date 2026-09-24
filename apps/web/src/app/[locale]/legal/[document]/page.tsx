import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isLocale } from '@photoo/shared';

import { absoluteUrl, localeAlternates } from '@/lib/site-url';

// The real texts are a lawyer task (docs/steps/human-followups.md, 0.7), but
// an imprint and a privacy policy have to be *reachable* from every page
// (docs/COMPLIANCE.md: Luxembourg e-commerce law, ePrivacy). Linking to a 404
// reads as "taken down", so each document gets an honest placeholder with a
// contact point until the drafted text replaces it.
const LEGAL_DOCUMENTS = ['imprint', 'privacy', 'terms', 'cookies'] as const;

type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

function isLegalDocument(value: string): value is LegalDocument {
  return (LEGAL_DOCUMENTS as readonly string[]).includes(value);
}

function legalPath(document: LegalDocument): string {
  return `/legal/${document}`;
}

export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((document) => ({ document }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; document: string }>;
}): Promise<Metadata> {
  const { locale, document } = await params;
  if (!isLocale(locale) || !isLegalDocument(document)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.legal' });
  const path = legalPath(document);
  return {
    title: t(`${document}.title`),
    // Placeholder text must never be indexed as if it were the real policy.
    robots: { index: false, follow: false },
    alternates: {
      canonical: absoluteUrl(locale, path),
      languages: localeAlternates(path),
    },
  };
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ locale: string; document: string }>;
}) {
  const { locale, document } = await params;
  if (!isLocale(locale) || !isLegalDocument(document)) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: 'web.legal' });

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold text-foreground">{t(`${document}.title`)}</h1>
      <p className="mt-6 text-muted-foreground">{t('pending')}</p>
      <p className="mt-4 text-muted-foreground">
        {t('contactIntro')}{' '}
        <a className="underline hover:text-foreground" href={`mailto:${t('contactEmail')}`}>
          {t('contactEmail')}
        </a>
      </p>
    </main>
  );
}
