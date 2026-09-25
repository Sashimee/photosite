'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { components } from '@photoo/api-client';
import { PublishLegalTextRequestSchema, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

type AdminCountry = components['schemas']['AdminCountry'];

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function PublishLegalTextForm({ country }: { country: AdminCountry }) {
  const t = useTranslations('admin.settings.detail.legalTexts.publish');
  const tErrors = useTranslations('admin.settings');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const tLocale = useTranslations('locale');
  const router = useRouter();
  const [kind, setKind] = useState('');
  const [locale, setLocale] = useState<Locale>(country.defaultLocale);
  const [localeTouched, setLocaleTouched] = useState(false);
  const [content, setContent] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!localeTouched) {
      setLocale(country.defaultLocale);
    }
  }, [country.defaultLocale, localeTouched]);

  const trimmedKind = kind.trim();
  const trimmedContent = content.trim();
  const parsed = PublishLegalTextRequestSchema.safeParse({
    kind: trimmedKind,
    locale,
    content: trimmedContent,
  });
  const kindTooLong = trimmedKind.length > 60;
  const contentTooLong = trimmedContent.length > 200_000;

  function resetFields() {
    setKind('');
    setContent('');
    setLocale(country.defaultLocale);
    setLocaleTouched(false);
    setAttempted(false);
  }

  function handleOpenChange(next: boolean) {
    setConfirmOpen(next);
    if (!next) {
      setSubmitError(null);
    }
  }

  function handleTriggerClick() {
    setAttempted(true);
    if (!parsed.success) {
      return;
    }
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    if (!parsed.success) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.POST('/v1/admin/countries/{code}/legal-texts', {
      params: { path: { code: country.code } },
      body: parsed.data,
    });
    setSubmitting(false);
    if (error) {
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      }
      return;
    }
    setConfirmOpen(false);
    resetFields();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-medium text-foreground">{t('title')}</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="legal-text-kind">{t('kindLabel')}</Label>
        <Input
          id="legal-text-kind"
          value={kind}
          placeholder={t('kindPlaceholder')}
          maxLength={60}
          onChange={(event) => {
            setKind(event.target.value);
          }}
          aria-invalid={attempted && (!trimmedKind || kindTooLong)}
          aria-describedby="legal-text-kind-error"
        />
        <FieldError
          id="legal-text-kind-error"
          message={
            attempted && !trimmedKind
              ? tValidation('required')
              : attempted && kindTooLong
                ? tValidation('tooLong')
                : undefined
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="legal-text-locale">{t('localeLabel')}</Label>
        <select
          id="legal-text-locale"
          value={locale}
          onChange={(event) => {
            setLocale(event.target.value as Locale);
            setLocaleTouched(true);
          }}
          className={SELECT_CLASSNAME}
        >
          {SUPPORTED_LOCALES.map((value) => (
            <option key={value} value={value}>
              {tLocale(value)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="legal-text-content">{t('contentLabel')}</Label>
        <textarea
          id="legal-text-content"
          rows={8}
          value={content}
          maxLength={200_000}
          onChange={(event) => {
            setContent(event.target.value);
          }}
          aria-invalid={attempted && (!trimmedContent || contentTooLong)}
          aria-describedby="legal-text-content-error"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <FieldError
          id="legal-text-content-error"
          message={
            attempted && !trimmedContent
              ? tValidation('required')
              : attempted && contentTooLong
                ? tValidation('tooLong')
                : undefined
          }
        />
      </div>
      <div>
        <Button type="button" onClick={handleTriggerClick}>
          {t('submit')}
        </Button>
      </div>
      <Dialog open={confirmOpen} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogTitle>{t('confirm.title', { kind: trimmedKind })}</DialogTitle>
          <DialogDescription>
            {t('confirm.description', {
              kind: trimmedKind,
              locale: tLocale(locale),
              country: country.name,
            })}
          </DialogDescription>
          {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="button" onClick={() => void handleConfirm()} disabled={submitting}>
              {t('confirm.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
