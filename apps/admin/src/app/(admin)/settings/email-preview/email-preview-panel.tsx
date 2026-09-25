'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import type { components } from '@photoo/api-client';
import { SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

type EmailTemplateName = components['schemas']['EmailTemplateName'];
type AdminEmailTemplatePreview = components['schemas']['AdminEmailTemplatePreview'];

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

type Status = 'loading' | 'error' | 'ready';

export function EmailPreviewPanel({ templates }: { templates: EmailTemplateName[] }) {
  const t = useTranslations('admin.settings.emailPreview');
  const tErrors = useTranslations('admin.settings');
  const tCommon = useTranslations('common');
  const tLocale = useTranslations('locale');

  const [template, setTemplate] = useState<EmailTemplateName | undefined>(templates[0]);
  const [locale, setLocale] = useState<Locale>('en');
  const [status, setStatus] = useState<Status>('loading');
  const [preview, setPreview] = useState<AdminEmailTemplatePreview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const tErrorsRef = useRef(tErrors);
  tErrorsRef.current = tErrors;

  useEffect(() => {
    if (!template) {
      return;
    }
    const currentTemplate = template;
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);

    async function load() {
      const { data, error } = await api.GET('/v1/admin/email-templates/{template}/preview', {
        params: { path: { template: currentTemplate }, query: { locale } },
      });
      if (cancelled) {
        return;
      }
      if (!data) {
        const translate = tErrorsRef.current;
        setErrorMessage(apiErrorMessage(translate, translate('errors.generic'), error));
        setStatus('error');
        return;
      }
      setPreview(data);
      setStatus('ready');
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [template, locale, reloadKey]);

  if (!template) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-preview-template">{t('templateLabel')}</Label>
          <select
            id="email-preview-template"
            value={template}
            onChange={(event) => {
              setTemplate(event.target.value as EmailTemplateName);
            }}
            className={SELECT_CLASSNAME}
          >
            {templates.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-preview-locale">{t('localeLabel')}</Label>
          <select
            id="email-preview-locale"
            value={locale}
            onChange={(event) => {
              setLocale(event.target.value as Locale);
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
      </div>

      {status === 'loading' ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground"
        >
          {tCommon('loading')}
        </div>
      ) : null}

      {status === 'error' ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-8 text-center text-sm text-destructive"
        >
          <p>{errorMessage ?? tCommon('error')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setReloadKey((key) => key + 1);
            }}
          >
            {tCommon('retry')}
          </Button>
        </div>
      ) : null}

      {status === 'ready' && preview ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">{t('subjectLabel')}</span>
            <p className="text-base text-foreground">{preview.subject}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">{t('htmlLabel')}</span>
              <iframe
                title={t('htmlLabel')}
                sandbox=""
                srcDoc={preview.html}
                className="h-[32rem] w-full rounded-md border border-border bg-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">{t('textLabel')}</span>
              <pre className="h-[32rem] w-full overflow-auto rounded-md border border-border bg-muted p-3 text-xs whitespace-pre-wrap text-foreground">
                {preview.text}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
