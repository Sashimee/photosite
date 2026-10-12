'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

import { DecisionDialog } from './decision-dialog';

interface Notice {
  tone: 'info' | 'error';
  text: string;
}

export function CheckActions({ checkId }: { checkId: string }) {
  const t = useTranslations('admin.provenance.detail.actions');
  const tErrors = useTranslations('admin.provenance');
  const router = useRouter();
  const [rechecking, setRechecking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleRecheck() {
    setNotice(null);
    setRechecking(true);
    try {
      const { error } = await api.POST('/v1/admin/provenance/{id}/recheck', {
        params: { path: { id: checkId } },
      });
      if (!error) {
        setNotice({ tone: 'info', text: t('rechecked') });
        router.refresh();
        return;
      }
      if (error.code === 'TWO_FACTOR_REQUIRED') {
        return;
      }
      setNotice({
        tone: 'error',
        text:
          error.code === 'CONFLICT'
            ? tErrors('errors.alreadyRunning')
            : apiErrorMessage(tErrors, tErrors('errors.generic'), error),
      });
    } finally {
      setRechecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {notice ? <FormNotice tone={notice.tone}>{notice.text}</FormNotice> : null}
      <div className="flex flex-wrap gap-2">
        <DecisionDialog
          checkId={checkId}
          onDecided={() => {
            router.refresh();
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={rechecking}
          onClick={() => void handleRecheck()}
        >
          {rechecking ? t('rechecking') : t('recheck')}
        </Button>
      </div>
    </div>
  );
}
