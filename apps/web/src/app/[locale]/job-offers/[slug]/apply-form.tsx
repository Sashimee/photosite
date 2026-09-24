'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { CreateJobApplicationRequestSchema } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { requestErrorMessage } from '@/lib/request-errors';

import {
  buildApplyPayload,
  EMPTY_APPLY_FORM_VALUES,
  mapApplyIssuePath,
  mapValidationErrorDetailPath,
  type ApplyFormValues,
} from './apply-form-helpers';

// Once the server has said "you already applied" or the applicant has just
// applied successfully, the form never comes back for this offer: a second
// submission attempt would only ever be rejected the same way, so there is
// nothing left for the applicant to change here (docs/steps/1B.9-professional-area.md).
type ApplyState = 'idle' | 'submitting' | 'success' | 'alreadyApplied';

export function ApplyForm({
  jobOfferId,
  applicationsHref,
  signInHref,
}: {
  jobOfferId: string;
  applicationsHref: string;
  signInHref?: string;
}) {
  const t = useTranslations('web.jobBoard.apply');
  const tValidation = useTranslations('common.validation');

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<ApplyFormValues>({ defaultValues: EMPTY_APPLY_FORM_VALUES });

  const [state, setState] = useState<ApplyState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const signedOut = Boolean(signInHref);

  async function onSubmit(values: ApplyFormValues) {
    setSubmitError(null);
    clearErrors();
    setState('submitting');

    const payload = buildApplyPayload(values);
    const result = CreateJobApplicationRequestSchema.safeParse(payload);
    if (!result.success) {
      let hasFieldError = false;
      for (const issue of result.error.issues) {
        const field = mapApplyIssuePath(issue.path);
        if (field) {
          setError(field, { type: issue.code });
          hasFieldError = true;
        }
      }
      if (!hasFieldError) {
        setSubmitError(t('errors.invalid'));
      }
      setState('idle');
      return;
    }

    const { error } = await api.POST('/v1/job-offers/{id}/applications', {
      params: { path: { id: jobOfferId } },
      body: payload,
    });

    if (error) {
      setState('idle');
      if (error.code === 'CONFLICT') {
        setState('alreadyApplied');
        return;
      }
      if (error.code === 'VALIDATION_ERROR') {
        const fields = mapValidationErrorDetailPath(error.details);
        const hasFieldError = fields.some((field) => field !== null);
        for (const field of fields) {
          if (field) {
            setError(field, { type: 'custom' });
          }
        }
        if (!hasFieldError) {
          setSubmitError(t('errors.invalid'));
        }
        return;
      }
      setSubmitError(requestErrorMessage(t, error));
      return;
    }

    setState('success');
  }

  if (state === 'success' || state === 'alreadyApplied') {
    return (
      <FormNotice tone="success">
        <p>{t(state === 'success' ? 'success' : 'alreadyApplied')}</p>
        <p>
          <Link href={applicationsHref} className="font-medium underline underline-offset-4">
            {t('viewApplicationsCta')}
          </Link>
        </p>
      </FormNotice>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-6"
      aria-disabled={signedOut}
    >
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
      {signedOut ? <FormNotice tone="info">{t('signedOutNotice')}</FormNotice> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="job-application-message">{t('messageLabel')}</Label>
        <Textarea
          id="job-application-message"
          disabled={signedOut}
          aria-invalid={Boolean(errors.message)}
          {...register('message')}
        />
        <FieldError
          id="job-application-message-error"
          message={fieldErrorMessage(tValidation, errors.message)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="job-application-portfolio-link">{t('portfolioLinkLabel')}</Label>
        <Input
          id="job-application-portfolio-link"
          type="url"
          disabled={signedOut}
          aria-invalid={Boolean(errors.portfolioLink)}
          {...register('portfolioLink')}
        />
        <FieldError
          id="job-application-portfolio-link-error"
          message={fieldErrorMessage(tValidation, errors.portfolioLink)}
        />
      </div>

      {signedOut && signInHref ? (
        <Button asChild className="self-start">
          <Link href={signInHref}>{t('signInCta')}</Link>
        </Button>
      ) : (
        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting ? t('submitting') : t('submitCta')}
        </Button>
      )}
    </form>
  );
}
