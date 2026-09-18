import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin-shell';
import { resolveNavSections } from '@/lib/admin-nav';
import { getSession } from '@/lib/server-api';
import { buildSignInRedirect } from '@/lib/sign-in-path';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get('x-pathname');
  const user = await getSession();

  if (!user) {
    redirect(buildSignInRedirect(pathname));
  }
  // Same response as an unmodified route: an admin surface must not confirm
  // its own existence to a signed-in client who isn't staff.
  if (!user.roles.includes('admin')) {
    notFound();
  }
  // requireAdminSession (apps/api) would refuse every call this shell makes
  // anyway; this only makes the reason explicit instead of a page that loads
  // and then fails on its first request. A per-session stale second factor
  // (the 12h window) isn't visible here — GET /v1/auth/session doesn't
  // expose it — so that case is caught reactively by the fetch wrapper
  // instead (src/lib/api.ts) once this shell calls an admin-guarded endpoint.
  if (!user.twoFactorEnabled) {
    redirect(buildSignInRedirect(pathname, 'enroll'));
  }

  const t = await getTranslations('admin.shell');

  return (
    <AdminShell email={user.email} navSections={resolveNavSections(t)} signOutLabel={t('signOut')}>
      {children}
    </AdminShell>
  );
}
