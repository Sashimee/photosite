import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { EmailVerificationRequired } from '@/components/email-verification-required';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { ProfessionalProfileForm } from './professional-profile-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.professional' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function ProfessionalProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/account/professional-profile`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, profileResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.professional' }),
    api.GET('/v1/me/professional-profile', { cache: 'no-store' }),
  ]);

  if (profileResult.response.status === 401) {
    redirect(signInHref);
  }

  const hasProfile = profileResult.response.status === 200;
  // `professional` is in SIGNUP_ROLES, so RolesPanel can add the role with no
  // profile behind it: this endpoint then 403s FORBIDDEN for an account with
  // no role at all, and 404s NOT_FOUND for one that has the role but no
  // profile row. Both mean "show the create form" here - the role is never
  // checked on its own (docs/steps/1B.9-professional-area.md).
  if (
    !hasProfile &&
    profileResult.response.status !== 403 &&
    profileResult.response.status !== 404
  ) {
    throw new Error(
      `Failed to load the professional profile: HTTP ${String(profileResult.response.status)}`,
    );
  }

  const existing = hasProfile ? (profileResult.data ?? null) : null;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
      <Link
        href={`/${locale}/account`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToAccount')}
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {t(existing ? 'editTitle' : 'createTitle')}
        </h1>
        {existing ? null : <p className="text-muted-foreground">{t('createIntro')}</p>}
      </div>

      {existing || user.emailVerifiedAt ? (
        <ProfessionalProfileForm existing={existing} email={user.email} />
      ) : (
        <EmailVerificationRequired email={user.email} />
      )}
    </section>
  );
}
