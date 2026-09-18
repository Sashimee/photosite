'use client';

import { useRouter } from 'next/navigation';

import type { components } from '@photoo/api-client';

import { ApproveDialog } from './approve-dialog';
import { ClaimPanel } from './claim-panel';
import { RejectDialog } from './reject-dialog';

type AdminVerificationCase = components['schemas']['AdminVerificationCase'];

export function CaseActions({
  caseDetail,
  currentAdminId,
}: {
  caseDetail: AdminVerificationCase;
  currentAdminId: string;
}) {
  const router = useRouter();
  const refresh = () => {
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <ClaimPanel
        caseId={caseDetail.id}
        status={caseDetail.status}
        assignedAdminId={caseDetail.assignedAdminId}
        currentAdminId={currentAdminId}
        onClaimed={refresh}
      />
      {caseDetail.status === 'in_review' ? (
        <div className="flex flex-wrap gap-2">
          <ApproveDialog
            caseId={caseDetail.id}
            applicantId={caseDetail.userId}
            onApproved={refresh}
          />
          <RejectDialog
            caseId={caseDetail.id}
            applicantId={caseDetail.userId}
            onRejected={refresh}
          />
        </div>
      ) : null}
    </div>
  );
}
