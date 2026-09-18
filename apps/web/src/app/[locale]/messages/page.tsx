import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { ConversationList } from '@/components/messages/conversation-list';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

const MESSAGES_LIST_LIMIT = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.messages.list' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function MessagesListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cursor?: string; archived?: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const { cursor, archived } = await searchParams;
  const showArchived = archived === 'true';
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/messages`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, result] = await Promise.all([
    getTranslations({ locale, namespace: 'web.messages.list' }),
    api.GET('/v1/conversations', {
      params: {
        query: {
          limit: MESSAGES_LIST_LIMIT,
          ...(cursor ? { cursor } : {}),
          ...(showArchived ? { archived: 'true' } : {}),
        },
      },
      cache: 'no-store',
    }),
  ]);

  if (result.response.status === 401) {
    redirect(signInHref);
  }
  if (!result.data) {
    throw new Error(`Failed to load conversations: HTTP ${String(result.response.status)}`);
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
      </div>

      <div className="flex gap-2 text-sm">
        <Link
          href={`/${locale}/messages`}
          className={
            showArchived ? 'text-muted-foreground' : 'font-medium text-foreground underline'
          }
        >
          {t('filterActive')}
        </Link>
        <Link
          href={`/${locale}/messages?archived=true`}
          className={
            showArchived ? 'font-medium text-foreground underline' : 'text-muted-foreground'
          }
        >
          {t('filterArchived')}
        </Link>
      </div>

      {result.data.items.length === 0 ? (
        <p className="text-muted-foreground">{showArchived ? t('emptyArchived') : t('empty')}</p>
      ) : (
        <ConversationList
          conversations={result.data.items}
          currentUserId={user.id}
          locale={locale}
        />
      )}

      {result.data.nextCursor ? (
        <Link
          href={`/${locale}/messages?cursor=${encodeURIComponent(result.data.nextCursor)}${showArchived ? '&archived=true' : ''}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </section>
  );
}
