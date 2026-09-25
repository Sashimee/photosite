import { getFormatter, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { DocumentViewer } from '@/components/verification/document-viewer';
import { getSession, serverApi } from '@/lib/server-api';
import { buildSignInRedirect } from '@/lib/sign-in-path';

import { CaseActions } from './case-actions';
import { DecisionHistory } from './decision-history';

// Mirrors the same-shaped probe in app/(admin)/users/[id]/page.tsx: the
// audit-log endpoint needs 'superadmin', not 'verification', so a
// verification-only reviewer can open a case without being able to see its
// history. 200 renders the history, 403 hides it, anything else is a real
// failure.
async function canViewHistory(
  api: Awaited<ReturnType<typeof serverApi>>,
  caseId: string,
): Promise<boolean> {
  const { data, response } = await api.GET('/v1/admin/audit-log', {
    params: { query: { targetId: caseId, limit: 1 } },
  });
  if (data) {
    return true;
  }
  if (response.status === 403) {
    return false;
  }
  throw new Error(
    `Failed to check audit log access for verification case ${caseId}: HTTP ${String(response.status)}`,
  );
}

export default async function VerificationCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pathname = (await headers()).get('x-pathname');
  const api = await serverApi();

  const {
    data: caseDetail,
    error,
    response,
  } = await api.GET('/v1/admin/verification-cases/{id}', {
    params: { path: { id } },
  });

  if (response.status === 404) {
    notFound();
  }
  // The list of cases can go stale between page loads, but this page also
  // requires a second factor proven within the last 15 minutes (fresher
  // than the 12h admin-session window), which the layout can't see, so it
  // is caught here instead - the client-side redirect in lib/api.ts only
  // covers fetches made from client components.
  if (response.status === 403 && error?.code === 'TWO_FACTOR_REQUIRED') {
    redirect(buildSignInRedirect(pathname, 'reverify'));
  }
  if (!caseDetail) {
    throw new Error(`Failed to load verification case ${id}: HTTP ${String(response.status)}`);
  }

  const admin = await getSession();
  if (!admin) {
    throw new Error(
      'VerificationCaseDetailPage rendered without a session; the (admin) layout should have redirected first',
    );
  }

  const allowHistory = await canViewHistory(api, id);

  const t = await getTranslations('admin.verification.detail');
  const tStatuses = await getTranslations('admin.verification.statuses');
  const format = await getFormatter();

  // Never forwards `downloadUrl`: this endpoint presigns and returns one for
  // every scanned-clean document (apps/api's AdminVerificationService.get),
  // so the fields sent to the client are picked explicitly rather than
  // spread, keeping any download URL out of the page's initial HTML.
  const documents = caseDetail.documents.map((document) => ({
    id: document.id,
    documentKey: document.documentKey,
    mimeType: document.mimeType,
    virusScanStatus: document.virusScanStatus,
    uploadedAt: document.uploadedAt,
  }));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="font-mono text-sm text-muted-foreground">{caseDetail.id}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('fields.applicant')}</dt>
        <dd className="font-mono text-foreground">{caseDetail.userId}</dd>
        <dt className="text-muted-foreground">{t('fields.country')}</dt>
        <dd className="text-foreground">{caseDetail.countryCode}</dd>
        <dt className="text-muted-foreground">{t('fields.status')}</dt>
        <dd className="text-foreground">{tStatuses(caseDetail.status)}</dd>
        <dt className="text-muted-foreground">{t('fields.submittedAt')}</dt>
        <dd className="text-foreground">
          {caseDetail.submittedAt
            ? format.dateTime(new Date(caseDetail.submittedAt), 'medium')
            : t('fields.notSubmitted')}
        </dd>
        <dt className="text-muted-foreground">{t('fields.businessName')}</dt>
        <dd className="text-foreground">{caseDetail.businessName ?? t('fields.notProvided')}</dd>
        <dt className="text-muted-foreground">{t('fields.vatNumber')}</dt>
        <dd className="text-foreground">{caseDetail.vatNumber ?? t('fields.notProvided')}</dd>
        <dt className="text-muted-foreground">{t('fields.businessRegistrationNumber')}</dt>
        <dd className="text-foreground">
          {caseDetail.businessRegistrationNumber ?? t('fields.notProvided')}
        </dd>
        {caseDetail.rejectionReason ? (
          <>
            <dt className="text-muted-foreground">{t('fields.rejectionReason')}</dt>
            <dd className="text-foreground">{caseDetail.rejectionReason}</dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('documents.title')}</h2>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('documents.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
              >
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="font-medium text-foreground">{document.documentKey}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('documents.uploadedAt', {
                      date: format.dateTime(new Date(document.uploadedAt), 'medium'),
                    })}
                  </span>
                </div>
                <DocumentViewer caseId={caseDetail.id} document={document} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <CaseActions caseDetail={caseDetail} currentAdminId={admin.id} />

      {allowHistory ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-foreground">{t('history.title')}</h2>
          <DecisionHistory targetId={caseDetail.id} />
        </div>
      ) : null}
    </section>
  );
}
