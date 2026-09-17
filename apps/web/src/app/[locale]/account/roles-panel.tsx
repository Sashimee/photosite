'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SIGNUP_ROLES, type UserRole } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';

type SignUpRole = (typeof SIGNUP_ROLES)[number];

export function RolesPanel({ roles }: { roles: UserRole[] }) {
  const t = useTranslations('web.account.roles');
  const tRoles = useTranslations('web.auth.roles');
  const tErrors = useTranslations('web.auth');
  const router = useRouter();

  const [currentRoles, setCurrentRoles] = useState(roles);
  const availableRoles = SIGNUP_ROLES.filter((role) => !currentRoles.includes(role));
  const [selected, setSelected] = useState<SignUpRole | ''>(availableRoles[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function addRole(role: SignUpRole) {
    setPending(true);
    setError(null);
    setSuccess(false);
    const { data, error: apiError } = await api.POST('/v1/auth/roles', {
      body: { role },
    });
    setPending(false);
    if (apiError) {
      setError(authErrorMessage(tErrors, apiError));
      return;
    }
    setCurrentRoles(data.user.roles);
    setSelected('');
    setSuccess(true);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="roles-heading">
      <h2 id="roles-heading" className="text-lg font-semibold text-foreground">
        {t('title')}
      </h2>
      <ul className="flex flex-col gap-1 text-sm text-foreground">
        {currentRoles.map((role) => (
          <li key={role}>{tRoles(role)}</li>
        ))}
      </ul>
      {error ? <FormNotice tone="error">{error}</FormNotice> : null}
      {success ? <FormNotice tone="success">{t('added')}</FormNotice> : null}
      {availableRoles.length > 0 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (selected) {
              void addRole(selected);
            }
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-role-select">{t('addRoleLabel')}</Label>
            <select
              id="add-role-select"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value as SignUpRole);
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {tRoles(role)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending}>
            {t('addRoleCta')}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noneAvailable')}</p>
      )}
    </section>
  );
}
