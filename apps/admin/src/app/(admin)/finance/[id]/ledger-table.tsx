import { useFormatter, useTranslations } from 'next-intl';

import type { components } from '@photoo/api-client';

import { CopyText } from '@/components/copy-text';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCents } from '@/lib/money';

type LedgerEntry = components['schemas']['AdminLedgerEntry'];

export function LedgerTable({
  entries,
  caption,
  emptyLabel,
}: {
  entries: LedgerEntry[];
  caption: string;
  emptyLabel: string;
}) {
  const t = useTranslations('admin.finance.detail.ledger');
  const format = useFormatter();

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('columns.occurredAt')}</TableHead>
          <TableHead>{t('columns.type')}</TableHead>
          <TableHead className="text-right">{t('columns.amount')}</TableHead>
          <TableHead>{t('columns.stripeObjectId')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>{format.dateTime(new Date(entry.occurredAt), 'medium')}</TableCell>
            <TableCell>{t(`types.${entry.type}`)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCents(format, entry.amountCents, entry.currency)}
            </TableCell>
            <TableCell>
              <CopyText value={entry.stripeObjectId} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
