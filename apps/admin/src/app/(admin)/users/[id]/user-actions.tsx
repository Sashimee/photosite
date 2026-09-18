'use client';

import { useRouter } from 'next/navigation';

import type { components } from '@photoo/api-client';

import { ReactivateDialog } from './reactivate-dialog';
import { RolesDialog } from './roles-dialog';
import { SuspendDialog } from './suspend-dialog';

type AdminUser = components['schemas']['User'];

export function UserActions({
  user,
  canManageRoles,
}: {
  user: AdminUser;
  canManageRoles: boolean;
}) {
  const router = useRouter();
  const refresh = () => {
    router.refresh();
  };

  return (
    <div className="flex flex-wrap gap-2">
      {user.status === 'active' ? <SuspendDialog user={user} onSuspended={refresh} /> : null}
      {user.status === 'suspended' ? (
        <ReactivateDialog user={user} onReactivated={refresh} />
      ) : null}
      {canManageRoles ? <RolesDialog user={user} onRolesChanged={refresh} /> : null}
    </div>
  );
}
