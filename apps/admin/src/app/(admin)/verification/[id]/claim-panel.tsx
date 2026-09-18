'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { components } from '@photoo/api-client';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

type VerificationCaseStatus = components['schemas']['AdminVerificationCase']['status'];

export function ClaimPanel({
  caseId,
  status,
  assignedAdminId,
  currentAdminId,
  onClaimed,
}: {
  caseId: string;
  status: VerificationCaseStatus;
  assignedAdminId: string | null;
  currentAdminId: string;
  onClaimed: () => void;
}) {
  const t = useTranslations('admin.verification.detail.claim');
  const tErrors = useTranslations('admin.verification');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [claimedElsewhere, setClaimedElsewhere] = useState(false);

  async function handleStartReview() {
    setSubmitError(null);
    setClaimedElsewhere(false);
    setSubmitting(true);
    const { error } = await api.POST('/v1/admin/verification-cases/{id}/start-review', {
      params: { path: { id: caseId } },
    });
    setSubmitting(false);
    if (error) {
      if (error.code === 'TWO_FACTOR_REQUIRED') {
        return;
      }
      if (error.code === 'CONFLICT') {
        setClaimedElsewhere(true);
        onClaimed();
        return;
      }
      setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      return;
    }
    onClaimed();
  }

  if (status === 'submitted') {
    return (
      <div className="flex flex-col gap-2">
        {claimedElsewhere ? <FormNotice tone="info">{t('claimedWhileOpen')}</FormNotice> : null}
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <Button type="button" onClick={() => void handleStartReview()} disabled={submitting}>
          {t('start')}
        </Button>
      </div>
    );
  }

  if (status === 'in_review' && assignedAdminId && assignedAdminId !== currentAdminId) {
    return <FormNotice tone="info">{t('warning')}</FormNotice>;
  }

  if (status === 'in_review' && assignedAdminId === currentAdminId) {
    return <p className="text-sm text-muted-foreground">{t('youAreReviewing')}</p>;
  }

  return null;
}
