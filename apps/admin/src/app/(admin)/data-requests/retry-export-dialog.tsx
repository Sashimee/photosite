'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { components } from '@photoo/api-client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

type AdminDataRequest = components['schemas']['AdminDataRequest'];

const RETRY_EXPORT_ERROR_KEYS: Record<string, string> = {
  EXPORT_NOT_FAILED: 'exportNotFailed',
  USER_SUSPENDED: 'userSuspended',
  USER_DELETED: 'userDeleted',
  EXPORT_ALREADY_RETRIED: 'exportAlreadyRetried',
  EXPORT_OPEN: 'exportOpen',
  EXPORT_ALREADY_ANSWERED: 'exportAlreadyAnswered',
  TOO_MANY_REQUESTS: 'tooManyRequests',
};

// A stale-list code means someone else already changed this request or the
// user's export state since the row was loaded, so the list is re-fetched
// alongside showing the message.
const STALE_LIST_CODES = new Set([
  'EXPORT_NOT_FAILED',
  'EXPORT_ALREADY_RETRIED',
  'EXPORT_OPEN',
  'EXPORT_ALREADY_ANSWERED',
]);

export function RetryExportDialog({
  request,
  onRetried,
}: {
  request: AdminDataRequest;
  onRetried: () => void;
}) {
  const t = useTranslations('admin.dataRequests.list.retryExport');
  const tErrors = useTranslations('admin.dataRequests');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSubmitError(null);
    }
  }

  async function handleConfirm() {
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.POST('/v1/admin/data-requests/{id}/retry-export', {
      params: { path: { id: request.id } },
    });
    setSubmitting(false);
    if (error) {
      if (error.code === 'TWO_FACTOR_REQUIRED') {
        return;
      }
      const key = error.code ? RETRY_EXPORT_ERROR_KEYS[error.code] : undefined;
      setSubmitError(
        key ? t(`errors.${key}`) : apiErrorMessage(tErrors, tErrors('errors.generic'), error),
      );
      if (error.code && STALE_LIST_CODES.has(error.code)) {
        onRetried();
      }
      return;
    }
    setOpen(false);
    onRetried();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('consequences')}</DialogDescription>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void handleConfirm()} disabled={submitting}>
            {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
