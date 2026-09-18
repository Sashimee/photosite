import Link from 'next/link';
import type { ReactNode } from 'react';

import type { ResolvedNavSection } from '@/lib/admin-nav';

import { SignOutButton } from './sign-out-button';

export function AdminShell({
  email,
  navSections,
  signOutLabel,
  children,
}: {
  email: string;
  navSections: ResolvedNavSection[];
  signOutLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <nav
        aria-label="Admin sections"
        className="flex flex-col gap-1 border-b border-border p-4 md:w-56 md:border-b-0 md:border-r"
      >
        {navSections.map((section) =>
          section.available ? (
            <Link
              key={section.id}
              href={section.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {section.label}
            </Link>
          ) : (
            <div
              key={section.id}
              aria-disabled="true"
              className="flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm text-muted-foreground"
            >
              <span className="font-medium">{section.label}</span>
              <span className="text-xs">{section.note}</span>
            </div>
          ),
        )}
      </nav>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <span className="text-sm text-foreground">{email}</span>
          <SignOutButton label={signOutLabel} />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
