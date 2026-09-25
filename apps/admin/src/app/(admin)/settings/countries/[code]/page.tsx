import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { serverApi } from '@/lib/server-api';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { LastChanged } from '../../last-changed';
import { CountryEditForm } from './country-edit-form';
import { PublishLegalTextForm } from './publish-legal-text-form';

export default async function CountryDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const api = await serverApi();

  const [countriesResult, legalTextsResult] = await Promise.all([
    api.GET('/v1/admin/countries'),
    api.GET('/v1/admin/countries/{code}/legal-texts', { params: { path: { code } } }),
  ]);

  const t = await getTranslations('admin.settings.detail');
  const tCountries = await getTranslations('admin.settings.countries');
  const tErrors = await getTranslations('admin.settings');
  const format = await getFormatter();

  if (countriesResult.response.status === 403 || legalTextsResult.response.status === 403) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-sm text-muted-foreground">{tErrors('errors.forbidden')}</p>
      </section>
    );
  }

  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
  }

  const country = countriesResult.data.find((entry) => entry.code === code);
  if (!country) {
    notFound();
  }

  if (!legalTextsResult.data) {
    if (legalTextsResult.response.status === 404) {
      notFound();
    }
    throw new Error(
      `Failed to load legal texts for ${code}: HTTP ${String(legalTextsResult.response.status)}`,
    );
  }

  const versions = legalTextsResult.data.versions;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <Link
        href="/settings"
        className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
      >
        {t('back')}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{country.name}</h1>
        <LastChanged entityType="Country" targetId={country.code} />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{tCountries('columns.code')}</dt>
        <dd className="font-mono text-foreground">{country.code}</dd>
        <dt className="text-muted-foreground">{tCountries('columns.name')}</dt>
        <dd className="text-foreground">{country.name}</dd>
        <dt className="text-muted-foreground">{tCountries('columns.currency')}</dt>
        <dd className="text-foreground">{country.currency}</dd>
        <dt className="text-muted-foreground">{tCountries('columns.enabled')}</dt>
        <dd className="text-foreground">
          {country.enabled ? tCountries('yes') : tCountries('no')}
        </dd>
        <dt className="text-muted-foreground">{tCountries('columns.vatRate')}</dt>
        <dd className="text-foreground">{tCountries('vatRateValue', { rate: country.vatRate })}</dd>
        <dt className="text-muted-foreground">{tCountries('columns.defaultLocale')}</dt>
        <dd className="text-foreground">{country.defaultLocale}</dd>
        <dt className="text-muted-foreground">{tCountries('columns.accounts')}</dt>
        <dd className="text-foreground">{country.accountCount}</dd>
      </dl>

      <CountryEditForm country={country} />

      <div className="flex flex-col gap-6">
        <h2 className="text-lg font-medium text-foreground">{t('legalTexts.title')}</h2>

        <div className="flex flex-col gap-3">
          <h3 className="text-base font-medium text-foreground">{t('legalTexts.history.title')}</h3>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('legalTexts.history.empty')}</p>
          ) : (
            <Table>
              <caption className="sr-only">{t('legalTexts.history.caption')}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('legalTexts.history.columns.version')}</TableHead>
                  <TableHead>{t('legalTexts.history.columns.kind')}</TableHead>
                  <TableHead>{t('legalTexts.history.columns.locale')}</TableHead>
                  <TableHead>{t('legalTexts.history.columns.publishedAt')}</TableHead>
                  <TableHead>{t('legalTexts.history.columns.publishedBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((version) => (
                  <TableRow key={version.version}>
                    <TableCell className="font-mono">{version.version}</TableCell>
                    <TableCell>{version.kind}</TableCell>
                    <TableCell>{version.locale}</TableCell>
                    <TableCell>
                      {format.dateTime(new Date(version.publishedAt), 'medium')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {version.publishedByAdminId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <PublishLegalTextForm country={country} />
      </div>
    </section>
  );
}
