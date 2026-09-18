'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SetUserRolesRequestSchema, USER_ROLES, type UserRole } from '@photoo/shared';
import type { components } from '@photoo/api-client';

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

type AdminUser = components['schemas']['User'];

function toggleRole(roles: UserRole[], role: UserRole): UserRole[] {
  return roles.includes(role) ? roles.filter((value) => value !== role) : [...roles, role];
}

export function RolesDialog({
  user,
  onRolesChanged,
}: {
  user: AdminUser;
  onRolesChanged: () => void;
}) {
  const t = useTranslations('admin.users.detail.roles');
  const tRoles = useTranslations('admin.users.roles');
  const tErrors = useTranslations('admin.users');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<UserRole[]>(user.roles);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const removesPhotographer =
    user.roles.includes('photographer') && !selected.includes('photographer');
  const parsed = SetUserRolesRequestSchema.safeParse({ roles: selected });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSelected(user.roles);
      setSubmitError(null);
    }
  }

  async function handleConfirm() {
    if (!parsed.success) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.PUT('/v1/admin/users/{id}/roles', {
      params: { path: { id: user.id } },
      body: { roles: parsed.data.roles },
    });
    setSubmitting(false);
    if (error) {
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      }
      return;
    }
    setOpen(false);
    onRolesChanged();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">{t('trigger')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('title')}</legend>
          {USER_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={selected.includes(role)}
                onChange={() => {
                  setSelected((current) => toggleRole(current, role));
                }}
                className="size-4"
              />
              {tRoles(role)}
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-muted-foreground">
          {t('resultingSet', {
            roles: selected.map((role) => tRoles(role)).join(', ') || t('none'),
          })}
        </p>
        {removesPhotographer ? <FormNotice tone="info">{t('unpublishWarning')}</FormNotice> : null}
        {!parsed.success ? <FormNotice tone="error">{tValidation('required')}</FormNotice> : null}
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting || !parsed.success}
          >
            {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
