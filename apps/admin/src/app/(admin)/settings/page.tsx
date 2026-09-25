import { getTranslations } from 'next-intl/server';

import { serverApi } from '@/lib/server-api';

import { AutoReleaseForm } from './auto-release-form';
import { CountriesTable } from './countries-table';
import { FeeDialog } from './fee-dialog';
import { FlagsForm } from './flags-form';
import { LastChanged } from './last-changed';

export default async function SettingsPage() {
  const api = await serverApi();

  const [settingsResult, countriesResult] = await Promise.all([
    api.GET('/v1/admin/settings'),
    api.GET('/v1/admin/countries'),
  ]);

  const t = await getTranslations('admin.settings');

  if (settingsResult.response.status === 403 || countriesResult.response.status === 403) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-12">
        <p className="text-sm text-muted-foreground">{t('errors.forbidden')}</p>
      </section>
    );
  }
  if (!settingsResult.data) {
    throw new Error(
      `Failed to load platform settings: HTTP ${String(settingsResult.response.status)}`,
    );
  }
  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
  }

  const settings = settingsResult.data;
  const countries = countriesResult.data;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <LastChanged entityType="PlatformSetting" />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('fee.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('fee.currentLabel')}:{' '}
          <span className="font-medium text-foreground">
            {settings.feePercent === null
              ? t('fee.notConfigured')
              : t('fee.percent', { value: settings.feePercent })}
          </span>
        </p>
        <div>
          <FeeDialog currentFeePercent={settings.feePercent} />
        </div>
      </div>

      <AutoReleaseForm currentDays={settings.autoReleaseDays} />

      <FlagsForm flags={settings.featureFlags} />

      <div className="flex flex-col gap-3">
        <h2 id="settings-countries-heading" className="text-lg font-medium text-foreground">
          {t('countries.title')}
        </h2>
        <CountriesTable countries={countries} headingId="settings-countries-heading" />
      </div>
    </section>
  );
}
