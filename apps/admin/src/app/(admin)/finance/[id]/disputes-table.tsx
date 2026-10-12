import { useFormatter, useTranslations } from 'next-intl';

import type { components } from '@photoo/api-client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCents } from '@/lib/money';

type Dispute = components['schemas']['AdminDispute'];

export function DisputesTable({ disputes, currency }: { disputes: Dispute[]; currency: string }) {
  const t = useTranslations('admin.finance.detail.disputes');
  const tStatuses = useTranslations('admin.finance.disputeStatuses');
  const tCommon = useTranslations('admin.finance');
  const format = useFormatter();

  if (disputes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <Table>
      <caption className="sr-only">{t('caption')}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('columns.id')}</TableHead>
          <TableHead>{t('columns.status')}</TableHead>
          <TableHead>{t('columns.reason')}</TableHead>
          <TableHead>{t('columns.resolution')}</TableHead>
          <TableHead className="text-right">{t('columns.amountRefunded')}</TableHead>
          <TableHead>{t('columns.openedBy')}</TableHead>
          <TableHead>{t('columns.admin')}</TableHead>
          <TableHead>{t('columns.openedAt')}</TableHead>
          <TableHead>{t('columns.updatedAt')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {disputes.map((dispute) => (
          <TableRow key={dispute.id}>
            <TableCell className="font-mono text-xs">{dispute.id}</TableCell>
            <TableCell>{tStatuses(dispute.status)}</TableCell>
            <TableCell className="whitespace-pre-wrap">{dispute.reason}</TableCell>
            <TableCell className="whitespace-pre-wrap">
              {dispute.resolution ?? tCommon('none')}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {dispute.amountRefundedCents === null
                ? tCommon('none')
                : formatCents(format, dispute.amountRefundedCents, currency)}
            </TableCell>
            <TableCell className="font-mono text-xs">{dispute.openedById}</TableCell>
            <TableCell className="font-mono text-xs">
              {dispute.adminId ?? tCommon('none')}
            </TableCell>
            <TableCell>{format.dateTime(new Date(dispute.openedAt), 'medium')}</TableCell>
            <TableCell>{format.dateTime(new Date(dispute.updatedAt), 'medium')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
