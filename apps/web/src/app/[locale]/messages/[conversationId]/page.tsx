import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { IdSchema, isLocale, type Locale } from '@photoo/shared';

import { Thread } from '@/components/messages/thread';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; conversationId: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.messages.thread' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ locale: string; conversationId: string }>;
}) {
  const { locale: requestedLocale, conversationId } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  if (!IdSchema.safeParse(conversationId).success) {
    notFound();
  }
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/messages/${conversationId}`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, tParticipant, conversationResult, messagesResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.messages.thread' }),
    getTranslations({ locale, namespace: 'web.messages.participant' }),
    api.GET('/v1/conversations/{id}', {
      params: { path: { id: conversationId } },
      cache: 'no-store',
    }),
    api.GET('/v1/conversations/{id}/messages', {
      params: { path: { id: conversationId }, query: {} },
      cache: 'no-store',
    }),
  ]);

  if (conversationResult.response.status === 401 || messagesResult.response.status === 401) {
    redirect(signInHref);
  }
  if (conversationResult.response.status === 404 || conversationResult.response.status === 403) {
    notFound();
  }
  if (!conversationResult.data) {
    throw new Error(
      `Failed to load conversation "${conversationId}": HTTP ${String(conversationResult.response.status)}`,
    );
  }
  if (!messagesResult.data) {
    throw new Error(
      `Failed to load messages for conversation "${conversationId}": HTTP ${String(messagesResult.response.status)}`,
    );
  }

  return (
    <section className="mx-auto flex h-[calc(100vh-4rem)] max-w-2xl flex-col px-4 py-6">
      <Link
        href={`/${locale}/messages`}
        className="mb-3 self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToList')}
      </Link>
      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border">
        <Thread
          conversationId={conversationId}
          currentUserId={user.id}
          initialMessages={messagesResult.data.items}
          initialNextCursor={messagesResult.data.nextCursor}
          initialConversation={conversationResult.data}
          locale={locale}
          clientLabel={tParticipant('clientLabel')}
        />
      </div>
    </section>
  );
}
