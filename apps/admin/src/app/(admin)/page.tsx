import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { ADMIN_DASHBOARD_WINDOWS } from '@photoo/shared';

import { canOpenSection } from '@/lib/admin-nav';
import { formatCents } from '@/lib/money';
import { getSession, serverApi } from '@/lib/server-api';

import { KpiCard } from './kpi-card';

type DashboardWindow = (typeof ADMIN_DASHBOARD_WINDOWS)[number];

const DEFAULT_WINDOW: DashboardWindow = '30d';

const BACKLOG_QUEUES = [
  { key: 'verification', sectionId: 'verification', href: '/verification' },
  { key: 'provenance', sectionId: 'provenance', href: '/provenance' },
  { key: 'reports', sectionId: 'moderation', href: '/moderation' },
  { key: 'dataRequests', sectionId: 'data-requests', href: '/data-requests' },
] as const;

function parseWindow(raw: string | string[] | undefined): DashboardWindow {
  return ADMIN_DASHBOARD_WINDOWS.find((candidate) => candidate === raw) ?? DEFAULT_WINDOW;
}

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string | string[] }>;
}) {
  const shell = await getTranslations('admin.shell');
  const t = await getTranslations('admin.dashboard');
  const format = await getFormatter();
  const user = await getSession();

  if (!user) {
    throw new Error(
      'AdminHomePage rendered without a session; the (admin) layout should have redirected first',
    );
  }

  const window = parseWindow((await searchParams).window);
  const api = await serverApi();
  const [me, dashboard] = await Promise.all([
    api.GET('/v1/admin/me', { cache: 'no-store' }),
    api.GET('/v1/admin/dashboard', { params: { query: { window } }, cache: 'no-store' }),
  ]);
  if (!me.data) {
    throw new Error(
      `Admin permissions lookup failed with HTTP ${String(me.response.status)}; check the API at NEXT_PUBLIC_API_URL`,
    );
  }
  if (!dashboard.data) {
    throw new Error(
      `Dashboard lookup failed with HTTP ${String(dashboard.response.status)}; check the API at NEXT_PUBLIC_API_URL`,
    );
  }
  const { permissions } = me.data;
  const { signups, activity, money, backlogs, generatedAt } = dashboard.data;
  const days = Number.parseInt(window, 10);
  const count = (value: number) => format.number(value);

  const countCard = (label: string, metric: { current: number; previous: number }) => (
    <KpiCard
      key={label}
      label={label}
      currentDisplay={count(metric.current)}
      previousDisplay={count(metric.previous)}
      delta={metric}
      t={t}
      format={format}
    />
  );

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {shell('signedInAs', { email: user.email })}
        </p>
        <nav aria-label={t('windowLabel')} className="flex flex-wrap gap-2">
          {ADMIN_DASHBOARD_WINDOWS.map((option) => (
            <Link
              key={option}
              href={`/?window=${option}`}
              aria-current={option === window ? 'true' : undefined}
              className="rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-accent aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground"
            >
              {t(`windows.${option}`)}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted-foreground">
          {t('comparison', { days })} ·{' '}
          {t('generatedAt', { at: format.dateTime(new Date(generatedAt), 'medium') })}
        </p>
      </header>

      <section aria-labelledby="dashboard-signups" className="flex flex-col gap-3">
        <h2 id="dashboard-signups" className="text-lg font-medium text-foreground">
          {t('signups.title')}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {countCard(t('signups.total'), signups.total)}
          {countCard(t('signups.client'), signups.client)}
          {countCard(t('signups.photographer'), signups.photographer)}
          {countCard(t('signups.professional'), signups.professional)}
        </dl>
      </section>

      <section aria-labelledby="dashboard-activity" className="flex flex-col gap-3">
        <h2 id="dashboard-activity" className="text-lg font-medium text-foreground">
          {t('activity.title')}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          {countCard(t('activity.requests'), activity.requests)}
          {countCard(t('activity.quotes'), activity.quotes)}
          {countCard(t('activity.bookings'), activity.bookings)}
        </dl>
      </section>

      <section aria-labelledby="dashboard-money" className="flex flex-col gap-3">
        <h2 id="dashboard-money" className="text-lg font-medium text-foreground">
          {t('money.title')}
        </h2>
        {money === null ? (
          <p className="text-sm text-muted-foreground">{t('money.requiresFinance')}</p>
        ) : (
          (['gmv', 'refunds', 'feeRevenue'] as const).map((metric) => (
            <div key={metric} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">{t(`money.${metric}`)}</h3>
              {money[metric].length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('money.noData')}</p>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {money[metric].map((entry) => (
                    <KpiCard
                      key={entry.currency}
                      label={entry.currency}
                      currentDisplay={formatCents(format, entry.current, entry.currency)}
                      previousDisplay={formatCents(format, entry.previous, entry.currency)}
                      delta={entry}
                      t={t}
                      format={format}
                    />
                  ))}
                </dl>
              )}
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="dashboard-backlogs" className="flex flex-col gap-3">
        <h2 id="dashboard-backlogs" className="text-lg font-medium text-foreground">
          {t('backlogs.title')}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BACKLOG_QUEUES.map(({ key, sectionId, href }) => (
            <li key={key} className="flex flex-col gap-1 rounded-lg border border-border p-4">
              <span className="text-sm text-muted-foreground">{t(`backlogs.${key}`)}</span>
              <span className="text-2xl font-semibold text-foreground">{count(backlogs[key])}</span>
              {canOpenSection(sectionId, permissions) ? (
                <Link href={href} className="text-sm font-medium text-primary underline">
                  {t('backlogs.open')}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
