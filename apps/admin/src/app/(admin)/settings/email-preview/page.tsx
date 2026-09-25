import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { serverApi } from '@/lib/server-api';

import { EmailPreviewPanel } from './email-preview-panel';

export default async function EmailPreviewPage() {
  const api = await serverApi();
  const templatesResult = await api.GET('/v1/admin/email-templates');

  const t = await getTranslations('admin.settings.emailPreview');
  const tErrors = await getTranslations('admin.settings');

  if (templatesResult.response.status === 403) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-12">
        <p className="text-sm text-muted-foreground">{tErrors('errors.forbidden')}</p>
      </section>
    );
  }

  if (!templatesResult.data) {
    throw new Error(
      `Failed to load email templates: HTTP ${String(templatesResult.response.status)}`,
    );
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12">
      <Link
        href="/settings"
        className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
      >
        {t('back')}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <EmailPreviewPanel templates={templatesResult.data} />
    </section>
  );
}
