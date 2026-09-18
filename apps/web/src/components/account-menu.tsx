'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import type { SessionUser } from '@/lib/session';
import { useSession } from '@/lib/use-session';

export function AccountMenu({ locale, user }: { locale: Locale; user: SessionUser }) {
  const t = useTranslations('web.account.menu');
  const router = useRouter();
  const { user: currentUser, refresh } = useSession(user);

  async function handleSignOut() {
    await api.POST('/v1/auth/sign-out');
    await refresh();
    router.push(`/${locale}`);
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {currentUser?.email ?? t('account')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/account`}>{t('account')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/requests`}>{t('myRequests')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/quotes`}>{t('quotes')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/messages`}>{t('messages')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void handleSignOut();
          }}
        >
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
