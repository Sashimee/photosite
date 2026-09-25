import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { serverApi } from '@/lib/server-api';

import { AuditTrail } from './audit-trail';
import { UserActions } from './user-actions';

// The session has no field for an admin's own permission grants, and there is
// no endpoint that exposes them (docs/steps/1D.2-admin-users.md), so
// superadmin-gated rendering piggybacks on the audit-log call the trail panel
// needs anyway: 200 means both it and the roles control can render, 403 means
// neither can, anything else is a real failure worth surfacing.
async function canManageRoles(
  api: Awaited<ReturnType<typeof serverApi>>,
  targetId: string,
): Promise<boolean> {
  const { data, response } = await api.GET('/v1/admin/audit-log', {
    params: { query: { targetId, limit: 1 } },
  });
  if (data) {
    return true;
  }
  if (response.status === 403) {
    return false;
  }
  throw new Error(
    `Failed to check audit log access for user ${targetId}: HTTP ${String(response.status)}`,
  );
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = await serverApi();

  const { data: user, response } = await api.GET('/v1/admin/users/{id}', {
    params: { path: { id } },
  });
  if (response.status === 404) {
    notFound();
  }
  if (!user) {
    throw new Error(`Failed to load user ${id}: HTTP ${String(response.status)}`);
  }

  const allowRoles = await canManageRoles(api, id);

  const t = await getTranslations('admin.users.detail');
  const tRoles = await getTranslations('admin.users.roles');
  const tStatuses = await getTranslations('admin.users.statuses');

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="font-mono text-sm text-muted-foreground">{user.id}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('fields.email')}</dt>
        <dd className="text-foreground">{user.email}</dd>
        <dt className="text-muted-foreground">{t('fields.roles')}</dt>
        <dd className="text-foreground">{user.roles.map((role) => tRoles(role)).join(', ')}</dd>
        <dt className="text-muted-foreground">{t('fields.status')}</dt>
        <dd className="text-foreground">{tStatuses(user.status)}</dd>
        <dt className="text-muted-foreground">{t('fields.country')}</dt>
        <dd className="text-foreground">{user.country}</dd>
        <dt className="text-muted-foreground">{t('fields.twoFactorEnabled')}</dt>
        <dd className="text-foreground">
          {user.twoFactorEnabled ? t('fields.yes') : t('fields.no')}
        </dd>
        <dt className="text-muted-foreground">{t('fields.emailVerifiedAt')}</dt>
        <dd className="text-foreground">{user.emailVerifiedAt ?? t('fields.never')}</dd>
        <dt className="text-muted-foreground">{t('fields.lastLoginAt')}</dt>
        <dd className="text-foreground">{user.lastLoginAt ?? t('fields.never')}</dd>
      </dl>

      <Link
        href={`/data-requests?userId=${id}`}
        className="text-sm underline-offset-4 hover:underline"
      >
        {t('dataRequestsLink')}
      </Link>

      <UserActions user={user} canManageRoles={allowRoles} />

      {allowRoles ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-foreground">{t('auditTrail.title')}</h2>
          <AuditTrail targetId={id} />
        </div>
      ) : null}
    </section>
  );
}
