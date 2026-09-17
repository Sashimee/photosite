'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

import { SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildLocaleSwitchHref } from '@/lib/locale-switch';

export function LocaleSwitcher({
  currentLocale,
  label,
  localeNames,
}: {
  currentLocale: Locale;
  label: string;
  localeNames: Record<Locale, string>;
}) {
  const pathname = usePathname();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label}>
          {localeNames[currentLocale]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((locale) => (
          <DropdownMenuItem key={locale} asChild>
            <Link href={buildLocaleSwitchHref(pathname, locale)} lang={locale} hrefLang={locale}>
              {localeNames[locale]}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
