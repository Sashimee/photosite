import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/server-api';
import { sanitizeNextPath } from '@/lib/next-param';

import { SignInForm, type SignInInitialMode } from './sign-in-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.signIn');
  return { title: t('title') };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reverify?: string; enroll?: string }>;
}) {
  const { next, reverify, enroll } = await searchParams;
  const user = await getSession();

  const needsReverify = reverify === '1' && Boolean(user?.twoFactorEnabled);
  const needsEnroll = enroll === '1' && user !== null && !user.twoFactorEnabled;

  if (user && !needsReverify && !needsEnroll) {
    redirect(sanitizeNextPath(next, '/'));
  }

  const initialMode: SignInInitialMode = needsReverify
    ? 'reverify'
    : needsEnroll
      ? 'enroll'
      : 'signIn';

  return <SignInForm initialMode={initialMode} next={next} />;
}
