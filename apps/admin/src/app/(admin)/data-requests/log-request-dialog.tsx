'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  AdminLogDataRequestBodySchema,
  DATA_REQUEST_TYPES,
  IdSchema,
  type DataRequestType,
} from '@photoo/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

const LOGGABLE_CHANNELS = ['email', 'support'] as const;
type LoggableChannel = (typeof LOGGABLE_CHANNELS)[number];

const LOG_REQUEST_ERROR_KEYS: Record<string, string> = {
  EXPORT_OPEN: 'exportOpen',
  DELETE_OPEN: 'deleteOpen',
  USER_SUSPENDED: 'userSuspended',
  USER_DELETED: 'userDeleted',
  BLOCKING_OBLIGATIONS: 'blockingObligations',
};

function nowLocalDateTimeValue(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function toIsoDateTime(localValue: string): string | undefined {
  if (!localValue) {
    return undefined;
  }
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function LogRequestDialog({ onLogged }: { onLogged: () => void }) {
  const t = useTranslations('admin.dataRequests.list.logRequest');
  const tErrors = useTranslations('admin.dataRequests');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [type, setType] = useState<DataRequestType | ''>('');
  const [channel, setChannel] = useState<LoggableChannel | ''>('');
  const [receivedAt, setReceivedAt] = useState(nowLocalDateTimeValue);
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedUserId = userId.trim();
  const isoReceivedAt = toIsoDateTime(receivedAt);
  const parsed = AdminLogDataRequestBodySchema.safeParse({
    userId: trimmedUserId,
    type: type || undefined,
    channel: channel || undefined,
    receivedAt: isoReceivedAt ?? '',
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setReceivedAt(nowLocalDateTimeValue());
    } else {
      setUserId('');
      setType('');
      setChannel('');
      setAttempted(false);
      setSubmitError(null);
    }
  }

  async function handleConfirm() {
    setAttempted(true);
    if (!parsed.success) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.POST('/v1/admin/data-requests', { body: parsed.data });
    setSubmitting(false);
    if (error) {
      if (error.code === 'TWO_FACTOR_REQUIRED') {
        return;
      }
      const key = error.code ? LOG_REQUEST_ERROR_KEYS[error.code] : undefined;
      setSubmitError(
        key ? t(`errors.${key}`) : apiErrorMessage(tErrors, tErrors('errors.generic'), error),
      );
      return;
    }
    setOpen(false);
    onLogged();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('consequences')}</DialogDescription>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="log-request-user-id">{t('userIdLabel')}</Label>
          <Input
            id="log-request-user-id"
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
            }}
            placeholder={t('userIdPlaceholder')}
            aria-invalid={
              attempted && !IdSchema.safeParse(trimmedUserId).success ? true : undefined
            }
            aria-describedby="log-request-user-id-error"
          />
          <FieldError
            id="log-request-user-id-error"
            message={
              attempted && !trimmedUserId
                ? tValidation('required')
                : attempted && !IdSchema.safeParse(trimmedUserId).success
                  ? tValidation('invalidFormat')
                  : undefined
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="log-request-type">{t('typeLabel')}</Label>
          <select
            id="log-request-type"
            value={type}
            onChange={(event) => {
              setType(event.target.value as DataRequestType | '');
            }}
            aria-invalid={attempted && !type ? true : undefined}
            aria-describedby="log-request-type-error"
            className={SELECT_CLASSNAME}
          >
            <option value="">{t('typePlaceholder')}</option>
            {DATA_REQUEST_TYPES.map((value) => (
              <option key={value} value={value}>
                {tErrors(`types.${value}`)}
              </option>
            ))}
          </select>
          <FieldError
            id="log-request-type-error"
            message={attempted && !type ? tValidation('required') : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="log-request-channel">{t('channelLabel')}</Label>
          <select
            id="log-request-channel"
            value={channel}
            onChange={(event) => {
              setChannel(event.target.value as LoggableChannel | '');
            }}
            aria-invalid={attempted && !channel ? true : undefined}
            aria-describedby="log-request-channel-error"
            className={SELECT_CLASSNAME}
          >
            <option value="">{t('channelPlaceholder')}</option>
            {LOGGABLE_CHANNELS.map((value) => (
              <option key={value} value={value}>
                {tErrors(`channels.${value}`)}
              </option>
            ))}
          </select>
          <FieldError
            id="log-request-channel-error"
            message={attempted && !channel ? tValidation('required') : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="log-request-received-at">{t('receivedAtLabel')}</Label>
          <Input
            id="log-request-received-at"
            type="datetime-local"
            value={receivedAt}
            onChange={(event) => {
              setReceivedAt(event.target.value);
            }}
            aria-invalid={attempted && !isoReceivedAt ? true : undefined}
            aria-describedby="log-request-received-at-error"
          />
          <FieldError
            id="log-request-received-at-error"
            message={
              attempted && !receivedAt
                ? tValidation('required')
                : attempted && !isoReceivedAt
                  ? tValidation('invalidFormat')
                  : undefined
            }
          />
        </div>
        {type === 'delete' ? <FormNotice tone="info">{t('deleteWarning')}</FormNotice> : null}
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
