'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import type { components } from '@photoo/api-client';
import {
  CreateProfessionalProfileRequestSchema,
  UpdateProfessionalProfileRequestSchema,
} from '@photoo/shared';

import { EmailVerificationRequired } from '@/components/email-verification-required';
import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { requestErrorMessage } from '@/lib/request-errors';

import { LogoUploadField } from './logo-upload-field';
import {
  buildProfessionalProfilePayload,
  defaultValuesFromProfessionalProfile,
  mapProfessionalProfileIssuePath,
  mapValidationErrorDetailPath,
  type ProfessionalProfileFormValues,
} from './professional-profile-form-helpers';

type OwnProfessionalProfile = components['schemas']['OwnProfessionalProfile'];

export function ProfessionalProfileForm({
  existing,
  email,
}: {
  existing: OwnProfessionalProfile | null;
  email: string;
}) {
  const t = useTranslations('web.professional');
  const tValidation = useTranslations('common.validation');
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<ProfessionalProfileFormValues>({
    defaultValues: defaultValuesFromProfessionalProfile(existing),
  });

  const [logoUploadId, setLogoUploadId] = useState<string | null | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);

  async function onSubmit(values: ProfessionalProfileFormValues) {
    setSubmitError(null);
    setSuccessMessage(null);
    setNeedsEmailVerification(false);
    clearErrors();

    const payload = buildProfessionalProfilePayload(values, logoUploadId);

    // Validates with the real contract schema, but sends `payload` itself
    // rather than `result.data`, the same reasoning as the photographer
    // profile form's own comment (profile-form.tsx): `payload` never carries
    // an omitted `logoUploadId` key at all, so `exactOptionalPropertyTypes`
    // has nothing to reject once it's sent as the request body.
    const schema = existing
      ? UpdateProfessionalProfileRequestSchema
      : CreateProfessionalProfileRequestSchema;
    const result = schema.safeParse(payload);
    if (!result.success) {
      let hasFieldError = false;
      for (const issue of result.error.issues) {
        const field = mapProfessionalProfileIssuePath(issue.path);
        if (field) {
          setError(field, { type: issue.code });
          hasFieldError = true;
        }
      }
      if (!hasFieldError) {
        setSubmitError(t('errors.invalid'));
      }
      return;
    }

    const { error } = existing
      ? await api.PATCH('/v1/me/professional-profile', { body: payload })
      : await api.POST('/v1/me/professional-profile', { body: payload });

    if (error) {
      if (error.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsEmailVerification(true);
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
      if (error.code === 'CONFLICT') {
        // The API reuses CONFLICT for two unrelated causes: an existing
        // profile on create, an already-attached logo upload on update.
        setSubmitError(existing ? t('errors.logoConflict') : t('errors.alreadyExists'));
        return;
      }
      setSubmitError(requestErrorMessage(t, error));
      return;
    }

    setSuccessMessage(existing ? t('saved') : t('created'));
    setLogoUploadId(undefined);
    router.refresh();
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-8"
    >
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
      {successMessage ? <FormNotice tone="success">{successMessage}</FormNotice> : null}
      {needsEmailVerification ? <EmailVerificationRequired email={email} /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="professional-company-name">{t('companyNameLabel')}</Label>
        <Input
          id="professional-company-name"
          aria-invalid={Boolean(errors.companyName)}
          {...register('companyName')}
        />
        <FieldError
          id="professional-company-name-error"
          message={fieldErrorMessage(tValidation, errors.companyName)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="professional-website">{t('websiteLabel')}</Label>
        <Input
          id="professional-website"
          type="url"
          aria-invalid={Boolean(errors.website)}
          {...register('website')}
        />
        <FieldError
          id="professional-website-error"
          message={fieldErrorMessage(tValidation, errors.website)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="professional-vat-number">{t('vatNumberLabel')}</Label>
        <Input
          id="professional-vat-number"
          aria-invalid={Boolean(errors.vatNumber)}
          {...register('vatNumber')}
        />
        <FieldError
          id="professional-vat-number-error"
          message={fieldErrorMessage(tValidation, errors.vatNumber)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">{t('logoHeading')}</h2>
        <p className="text-sm text-muted-foreground">{t('logoHint')}</p>
        <LogoUploadField
          logoUrl={existing?.logoUrl ?? null}
          companyName={existing?.companyName ?? ''}
          onChange={setLogoUploadId}
        />
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('saving') : t(existing ? 'saveCta' : 'createCta')}
      </Button>
    </form>
  );
}
