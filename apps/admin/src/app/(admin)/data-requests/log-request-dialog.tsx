'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import {
  AdminLogDataRequestBodySchema,
  DATA_REQUEST_TYPES,
  IdSchema,
  LOGGABLE_DATA_REQUEST_CHANNELS,
  type DataRequestChannel,
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
import { apiErrorMessage, type ApiErrorLike } from '@/lib/api-errors';
import { maskEmail } from '@/lib/user-mask';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

type LoggableChannel = Exclude<DataRequestChannel, 'in_app'>;

const LOG_REQUEST_ERROR_KEYS: Record<string, string> = {
  EXPORT_OPEN: 'exportOpen',
  DELETE_OPEN: 'deleteOpen',
  USER_SUSPENDED: 'userSuspended',
  USER_DELETED: 'userDeleted',
};

const RECEIVED_AT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type AccountLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; email: string; name: string | null }
  | { status: 'not_found' }
  | { status: 'error' };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalDateTimeValue(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nowLocalDateTimeValue(): string {
  return toLocalDateTimeValue(new Date());
}

function toIsoDateTime(localValue: string): string | undefined {
  if (!localValue) {
    return undefined;
  }
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function blockingObligationReason(details: unknown): string | undefined {
  if (details && typeof details === 'object' && 'reason' in details) {
    const { reason } = details;
    return typeof reason === 'string' ? reason : undefined;
  }
  return undefined;
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
  const [account, setAccount] = useState<AccountLookup>({ status: 'idle' });
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);

  const trimmedUserId = userId.trim();
  const isoReceivedAt = toIsoDateTime(receivedAt);
  const parsed = AdminLogDataRequestBodySchema.safeParse({
    userId: trimmedUserId,
    type: type || undefined,
    channel: channel || undefined,
    receivedAt: isoReceivedAt ?? '',
  });

  useEffect(() => {
    if (!IdSchema.safeParse(trimmedUserId).success) {
      setAccount({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setAccount({ status: 'loading' });
    async function load() {
      const { data, response } = await api.GET('/v1/admin/users/{id}', {
        params: { path: { id: trimmedUserId } },
      });
      if (cancelled) {
        return;
      }
      if (data) {
        setAccount({ status: 'found', email: data.email, name: data.name });
        return;
      }
      if (response.status === 404) {
        setAccount({ status: 'not_found' });
        return;
      }
      setAccount({ status: 'error' });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [trimmedUserId]);

  useEffect(() => {
    setDeleteConfirmPending(false);
  }, [userId, type, channel, receivedAt]);

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

  function resolveErrorMessage(error: ApiErrorLike): string {
    if (error.code === 'TWO_FACTOR_REQUIRED') {
      return t('errors.twoFactorRequired');
    }
    if (error.code === 'PROTECTED_TARGET') {
      return t('errors.protectedTarget');
    }
    if (error.code === 'BLOCKING_OBLIGATIONS') {
      const reason = blockingObligationReason(error.details);
      if (reason === 'VERIFICATION_IN_REVIEW') {
        return t('errors.blockingObligationsVerificationInReview');
      }
      if (reason === 'ACCEPTED_QUOTE_WITHDRAWAL_WINDOW') {
        return t('errors.blockingObligationsAcceptedQuoteWithdrawalWindow');
      }
      return t('errors.blockingObligations');
    }
    const key = error.code ? LOG_REQUEST_ERROR_KEYS[error.code] : undefined;
    return key ? t(`errors.${key}`) : apiErrorMessage(tErrors, tErrors('errors.generic'), error);
  }

  async function handleConfirm() {
    setAttempted(true);
    if (!parsed.success || account.status !== 'found') {
      return;
    }
    if (type === 'delete' && !deleteConfirmPending) {
      setDeleteConfirmPending(true);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.POST('/v1/admin/data-requests', { body: parsed.data });
    setSubmitting(false);
    if (error) {
      setSubmitError(resolveErrorMessage(error));
      return;
    }
    setOpen(false);
    onLogged();
  }

  const receivedAtMin = toLocalDateTimeValue(new Date(Date.now() - RECEIVED_AT_MAX_AGE_MS));
  const receivedAtMax = nowLocalDateTimeValue();
  const confirmLabel =
    type === 'delete' && deleteConfirmPending ? t('confirmDeletion') : t('confirm');
  const confirmButtonClassName =
    type === 'delete' && deleteConfirmPending
      ? 'border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'
      : undefined;

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
          {account.status === 'loading' ? (
            <p className="text-sm text-muted-foreground">{t('accountLoading')}</p>
          ) : null}
          {account.status === 'not_found' ? (
            <FormNotice tone="error">{t('accountNotFound')}</FormNotice>
          ) : null}
          {account.status === 'error' ? (
            <FormNotice tone="error">{t('accountLookupError')}</FormNotice>
          ) : null}
          {account.status === 'found' ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('accountEmailLabel')}</dt>
              <dd>{maskEmail(account.email)}</dd>
              <dt className="text-muted-foreground">{t('accountNameLabel')}</dt>
              <dd>{account.name ?? t('accountNameUnset')}</dd>
            </dl>
          ) : null}
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
            {LOGGABLE_DATA_REQUEST_CHANNELS.map((value) => (
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
            min={receivedAtMin}
            max={receivedAtMax}
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
        {type === 'delete' ? <FormNotice tone="error">{t('deleteWarning')}</FormNotice> : null}
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className={confirmButtonClassName}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
