'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import { retryAfterSeconds } from '@/lib/auth-errors';

import {
  DecisionFields,
  emptyDecisionDraft,
  validateDecision,
  type DecisionDraft,
  type DecisionErrors,
  type DecisionRequest,
} from './decision-form';

export interface BulkTarget {
  id: string;
  label: string;
}

type RowResult = { ok: true } | { ok: false; message: string } | { ok: false; notAttempted: true };

type RowOutcome =
  | { kind: 'row'; result: RowResult }
  | { kind: 'rateLimited'; retryAfterSeconds: number | undefined }
  | { kind: 'authRedirect' };

export function BulkDecisionDialog({
  status,
  targets,
  onFinished,
}: {
  status: 'approved' | 'rejected';
  targets: BulkTarget[];
  onFinished: (outcome: { failedIds: string[]; anySucceeded: boolean }) => void;
}) {
  const t = useTranslations('admin.provenance.bulk');
  const tList = useTranslations('admin.provenance.list.bulk');
  const tErrors = useTranslations('admin.provenance');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DecisionDraft>(() => emptyDecisionDraft(status));
  const [errors, setErrors] = useState<DecisionErrors>({});
  const [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<BulkTarget[]>([]);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [rateLimit, setRateLimit] = useState<{ seconds: number | undefined } | null>(null);

  function handleOpenChange(next: boolean) {
    if (running) {
      return;
    }
    setOpen(next);
    if (!next) {
      setDraft(emptyDecisionDraft(status));
      setErrors({});
      setSnapshot([]);
      setResults({});
      setRateLimit(null);
    }
  }

  async function decideOne(id: string, request: DecisionRequest): Promise<RowOutcome> {
    try {
      const { error } = await api.POST('/v1/admin/provenance/{id}/decision', {
        params: { path: { id } },
        body: request,
      });
      if (!error) {
        return { kind: 'row', result: { ok: true } };
      }
      if (error.code === 'UNAUTHORIZED' || error.code === 'TWO_FACTOR_REQUIRED') {
        return { kind: 'authRedirect' };
      }
      if (error.code === 'TOO_MANY_REQUESTS') {
        return { kind: 'rateLimited', retryAfterSeconds: retryAfterSeconds(error.details) };
      }
      return {
        kind: 'row',
        result: { ok: false, message: apiErrorMessage(tErrors, tErrors('errors.generic'), error) },
      };
    } catch {
      return { kind: 'row', result: { ok: false, message: tErrors('errors.generic') } };
    }
  }

  async function handleSubmit() {
    const validated = validateDecision(draft);
    if ('errors' in validated) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    setRunning(true);
    setSnapshot(targets);
    setResults({});
    setRateLimit(null);
    const outcome: Record<string, RowResult> = {};
    for (const [index, target] of targets.entries()) {
      const decided = await decideOne(target.id, validated.request);
      if (decided.kind === 'authRedirect') {
        break;
      }
      if (decided.kind === 'rateLimited') {
        for (const remaining of targets.slice(index)) {
          outcome[remaining.id] = { ok: false, notAttempted: true };
        }
        setResults({ ...outcome });
        setRateLimit({ seconds: decided.retryAfterSeconds });
        break;
      }
      outcome[target.id] = decided.result;
      setResults({ ...outcome });
    }
    setRunning(false);
    const failedIds = targets
      .filter((target) => !outcome[target.id]?.ok)
      .map((target) => target.id);
    onFinished({ failedIds, anySucceeded: failedIds.length < targets.length });
  }

  const finished = snapshot.length > 0 && !running;
  const anyFailed = Object.values(results).some((result) => !result.ok);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={status === 'approved' ? 'default' : 'outline'}
          disabled={targets.length === 0}
        >
          {status === 'approved' ? tList('approve') : tList('reject')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>
          {t('title', { count: snapshot.length > 0 ? snapshot.length : targets.length })}
        </DialogTitle>
        <DialogDescription>{t('consequences')}</DialogDescription>
        {snapshot.length === 0 ? (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <DecisionFields
              idPrefix={`bulk-${status}`}
              draft={draft}
              errors={errors}
              statuses={[status]}
              onChange={setDraft}
            />
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {tCommon('cancel')}
                </Button>
              </DialogClose>
              <Button type="submit">{t('confirm')}</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-medium text-foreground">{t('results')}</h3>
            <ul className="flex flex-col gap-1 text-sm" aria-busy={running}>
              {snapshot.map((target) => {
                const result = results[target.id];
                return (
                  <li key={target.id} className="flex flex-wrap gap-2">
                    <span className="text-foreground">{target.label}</span>
                    {result ? (
                      <span
                        className={
                          result.ok || 'notAttempted' in result
                            ? 'text-muted-foreground'
                            : 'text-destructive'
                        }
                      >
                        {result.ok
                          ? t('success')
                          : 'notAttempted' in result
                            ? t('notAttempted')
                            : t('failure', { message: result.message })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {finished && rateLimit ? (
              <FormNotice tone="error">
                {rateLimit.seconds === undefined
                  ? t('rateLimited')
                  : t('rateLimitedWithRetry', { seconds: rateLimit.seconds })}
              </FormNotice>
            ) : null}
            {finished && anyFailed ? <FormNotice tone="error">{t('failedHint')}</FormNotice> : null}
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button type="button" disabled={running}>
                  {tCommon('close')}
                </Button>
              </DialogClose>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
