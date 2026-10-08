'use client';

import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, type MouseEvent } from 'react';

import { SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { buildLocaleSwitchHref } from '@/lib/locale-switch';

export function LocaleSwitcher({
  currentLocale,
  label,
  localeNames,
  signedIn = false,
}: {
  currentLocale: Locale;
  label: string;
  localeNames: Record<Locale, string>;
  signedIn?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const pending = useRef(false);

  async function persistThenNavigate(locale: Locale, href: string) {
    if (pending.current) {
      return;
    }
    pending.current = true;
    try {
      const { error } = await api.PATCH('/v1/me/locale', { body: { locale } });
      if (error) {
        Sentry.captureMessage(`Persisting locale ${locale} failed`, 'warning');
      }
    } catch (error) {
      Sentry.captureException(error);
    } finally {
      pending.current = false;
      router.push(href);
    }
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>, locale: Locale, href: string) {
    if (!signedIn || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    void persistThenNavigate(locale, href);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label}>
          {localeNames[currentLocale]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((locale) => {
          const href = buildLocaleSwitchHref(pathname, locale);
          return (
            <DropdownMenuItem key={locale} asChild>
              <Link
                href={href}
                lang={locale}
                hrefLang={locale}
                onClick={(event) => {
                  handleClick(event, locale, href);
                }}
              >
                {localeNames[locale]}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
