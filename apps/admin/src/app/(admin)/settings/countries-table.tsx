'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import type { components } from '@photoo/api-client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { CountryToggleDialog } from './country-toggle-dialog';

type AdminCountry = components['schemas']['AdminCountry'];

export function CountriesTable({
  countries,
  headingId,
}: {
  countries: AdminCountry[];
  headingId: string;
}) {
  const t = useTranslations('admin.settings.countries');
  const router = useRouter();

  return (
    <Table aria-labelledby={headingId}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('columns.code')}</TableHead>
          <TableHead>{t('columns.name')}</TableHead>
          <TableHead>{t('columns.currency')}</TableHead>
          <TableHead>{t('columns.enabled')}</TableHead>
          <TableHead>{t('columns.vatRate')}</TableHead>
          <TableHead>{t('columns.defaultLocale')}</TableHead>
          <TableHead>{t('columns.accounts')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('manageLink')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {countries.map((country) => (
          <TableRow key={country.code}>
            <TableCell className="font-mono">{country.code}</TableCell>
            <TableCell>{country.name}</TableCell>
            <TableCell>{country.currency}</TableCell>
            <TableCell>{country.enabled ? t('yes') : t('no')}</TableCell>
            <TableCell>{t('vatRateValue', { rate: country.vatRate })}</TableCell>
            <TableCell>{country.defaultLocale}</TableCell>
            <TableCell>{country.accountCount}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <CountryToggleDialog
                  country={country}
                  onToggled={() => {
                    router.refresh();
                  }}
                />
                <Link
                  href={`/settings/countries/${country.code}`}
                  className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {t('manageLink')}
                </Link>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
