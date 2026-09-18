import { getTranslations } from 'next-intl/server';

import { getBuildInfo } from '@/lib/build-info';

import { ReadinessTable } from './readiness-table';

export default async function HealthPage() {
  const t = await getTranslations('admin.health');
  const build = getBuildInfo();

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('buildInfo.title')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('buildInfo.version')}</dt>
          <dd className="font-mono text-foreground">{build.version}</dd>
          <dt className="text-muted-foreground">{t('buildInfo.builtAt')}</dt>
          <dd className="text-foreground">{build.builtAt ?? t('buildInfo.unknown')}</dd>
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('readiness.caption')}</h2>
        <ReadinessTable />
      </div>
    </section>
  );
}
