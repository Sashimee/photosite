'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { Locale } from '@photoo/shared';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

export interface NavLink {
  href: string;
  label: string;
}

export function MobileNav({
  locale,
  links,
  signInLabel,
  signInHref,
  openLabel,
  closeLabel,
  menuTitle,
  switcherLabel,
  localeNames,
}: {
  locale: Locale;
  links: NavLink[];
  signInLabel: string;
  signInHref: string;
  openLabel: string;
  closeLabel: string;
  menuTitle: string;
  switcherLabel: string;
  localeNames: Record<Locale, string>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={openLabel} className="md:hidden">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" closeLabel={closeLabel}>
        <SheetTitle className="text-base font-semibold">{menuTitle}</SheetTitle>
        <nav aria-label={menuTitle} className="flex flex-col gap-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              lang={locale}
              onClick={() => {
                setOpen(false);
              }}
              className="text-sm font-medium text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href={signInHref}
            lang={locale}
            onClick={() => {
              setOpen(false);
            }}
            className="text-sm font-medium text-foreground"
          >
            {signInLabel}
          </Link>
          <LocaleSwitcher currentLocale={locale} label={switcherLabel} localeNames={localeNames} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
