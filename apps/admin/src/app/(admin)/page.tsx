import { getTranslations } from 'next-intl/server';

import { getSession } from '@/lib/server-api';

export default async function AdminHomePage() {
  const t = await getTranslations('admin.shell');
  const user = await getSession();

  if (!user) {
    throw new Error(
      'AdminHomePage rendered without a session; the (admin) layout should have redirected first',
    );
  }

  return (
    <section className="mx-auto flex max-w-xl flex-col gap-2 px-4 py-16">
      <p className="text-foreground">{t('signedInAs', { email: user.email })}</p>
    </section>
  );
}
