'use client';

import { useTranslations } from 'next-intl';

import {
  PROVENANCE_DECISION_REASONS,
  ProvenanceDecisionRequestSchema,
  type ProvenanceDecisionReason,
} from '@photoo/shared';

import { FieldError } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { fieldErrorMessage } from '@/lib/form-errors';

export type DecisionStatus = 'approved' | 'flagged' | 'rejected';

export interface DecisionDraft {
  status: DecisionStatus;
  note: string;
  decisionReason: ProvenanceDecisionReason | '';
  decisionReasonText: string;
}

export type DecisionField = 'note' | 'decisionReason' | 'decisionReasonText';
export type DecisionErrors = Partial<Record<DecisionField, string>>;

export interface DecisionRequest {
  status: DecisionStatus;
  note: string;
  decisionReason?: ProvenanceDecisionReason;
  decisionReasonText?: string;
}

export function emptyDecisionDraft(status: DecisionStatus): DecisionDraft {
  return { status, note: '', decisionReason: '', decisionReasonText: '' };
}

function toRequest(draft: DecisionDraft): DecisionRequest {
  const approving = draft.status === 'approved';
  const reasonText = draft.decisionReasonText.trim();
  return {
    status: draft.status,
    note: draft.note.trim(),
    ...(!approving && draft.decisionReason ? { decisionReason: draft.decisionReason } : {}),
    ...(!approving && reasonText ? { decisionReasonText: reasonText } : {}),
  };
}

const DECISION_FIELDS: readonly string[] = ['note', 'decisionReason', 'decisionReasonText'];

function isDecisionField(value: unknown): value is DecisionField {
  return typeof value === 'string' && DECISION_FIELDS.includes(value);
}

export function validateDecision(
  draft: DecisionDraft,
): { request: DecisionRequest } | { errors: DecisionErrors } {
  const request = toRequest(draft);
  const result = ProvenanceDecisionRequestSchema.safeParse(request);
  if (result.success) {
    return { request };
  }
  const errors: DecisionErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (isDecisionField(field) && !errors[field]) {
      errors[field] = issue.code;
    }
  }
  return { errors };
}

const TEXTAREA_CLASSNAME =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const SELECT_CLASSNAME =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function DecisionFields({
  idPrefix,
  draft,
  errors,
  statuses,
  onChange,
}: {
  idPrefix: string;
  draft: DecisionDraft;
  errors: DecisionErrors;
  statuses: readonly DecisionStatus[];
  onChange: (next: DecisionDraft) => void;
}) {
  const t = useTranslations('admin.provenance.decision');
  const tStatuses = useTranslations('admin.provenance.decisionStatuses');
  const tReasons = useTranslations('admin.provenance.reasons');
  const tValidation = useTranslations('common.validation');
  const needsReason = draft.status !== 'approved';

  function changeStatus(status: DecisionStatus) {
    onChange(
      status === 'approved'
        ? { ...draft, status, decisionReason: '', decisionReasonText: '' }
        : { ...draft, status },
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-status`}>{t('statusLabel')}</Label>
        <select
          id={`${idPrefix}-status`}
          value={draft.status}
          onChange={(event) => {
            changeStatus(event.target.value as DecisionStatus);
          }}
          className={SELECT_CLASSNAME}
        >
          {statuses.map((value) => (
            <option key={value} value={value}>
              {tStatuses(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-note`}>{t('noteLabel')}</Label>
        <textarea
          id={`${idPrefix}-note`}
          rows={3}
          value={draft.note}
          onChange={(event) => {
            onChange({ ...draft, note: event.target.value });
          }}
          aria-invalid={Boolean(errors.note)}
          aria-describedby={`${idPrefix}-note-hint ${idPrefix}-note-error`}
          className={TEXTAREA_CLASSNAME}
        />
        <p id={`${idPrefix}-note-hint`} className="text-xs text-muted-foreground">
          {t('noteHint')}
        </p>
        <FieldError
          id={`${idPrefix}-note-error`}
          message={errors.note ? fieldErrorMessage(tValidation, { type: errors.note }) : undefined}
        />
      </div>

      {needsReason ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-reason`}>{t('reasonLabel')}</Label>
          <select
            id={`${idPrefix}-reason`}
            value={draft.decisionReason}
            onChange={(event) => {
              onChange({
                ...draft,
                decisionReason: event.target.value as DecisionDraft['decisionReason'],
              });
            }}
            aria-invalid={Boolean(errors.decisionReason)}
            aria-describedby={`${idPrefix}-reason-error`}
            className={SELECT_CLASSNAME}
          >
            <option value="">{t('reasonPlaceholder')}</option>
            {PROVENANCE_DECISION_REASONS.map((value) => (
              <option key={value} value={value}>
                {tReasons(value)}
              </option>
            ))}
          </select>
          <FieldError
            id={`${idPrefix}-reason-error`}
            message={errors.decisionReason ? t('errors.reasonRequired') : undefined}
          />
        </div>
      ) : null}

      {needsReason ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-reason-text`}>{t('reasonTextLabel')}</Label>
          <textarea
            id={`${idPrefix}-reason-text`}
            rows={3}
            value={draft.decisionReasonText}
            onChange={(event) => {
              onChange({ ...draft, decisionReasonText: event.target.value });
            }}
            aria-invalid={Boolean(errors.decisionReasonText)}
            aria-describedby={`${idPrefix}-reason-text-hint ${idPrefix}-reason-text-error`}
            className={TEXTAREA_CLASSNAME}
          />
          <p id={`${idPrefix}-reason-text-hint`} className="text-xs text-muted-foreground">
            {t('reasonTextHint')}
          </p>
          <FieldError
            id={`${idPrefix}-reason-text-error`}
            message={errors.decisionReasonText ? t('errors.reasonTextRequired') : undefined}
          />
        </div>
      ) : null}
    </>
  );
}
