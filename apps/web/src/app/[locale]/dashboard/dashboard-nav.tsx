'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { Locale } from '@photoo/shared';

import { cn } from '@/lib/utils';

export interface DashboardNavLink {
  href: string;
  label: string;
}

export function DashboardNav({
  locale,
  links,
  menuTitle,
}: {
  locale: Locale;
  links: DashboardNavLink[];
  menuTitle: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={menuTitle} className="flex gap-4 border-b border-border pb-4">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            lang={locale}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-sm font-medium',
              active
                ? 'text-foreground underline underline-offset-4'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
