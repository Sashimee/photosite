import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { api } from '../../lib/api';
import type { ApiErrorLike } from '../../lib/auth-errors';
import { useAuth } from '../../lib/auth-context';
import { FormNotice } from '../form/form-notice';
import { PrimaryButton } from '../form/primary-button';

const ERROR_KEYS: Record<string, string> = {
  ROLE_ALREADY_ASSIGNED: 'roleAlreadyAssigned',
  UNAUTHORIZED: 'unauthorized',
  TOO_MANY_REQUESTS: 'tooManyRequests',
};

function errorKey(error: ApiErrorLike | undefined): string {
  return (error?.code ? ERROR_KEYS[error.code] : undefined) ?? 'generic';
}

export function AccountProfile() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return null;
  }
  const isPhotographer = user.roles.includes('photographer');

  async function becomePhotographer() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const { data, error: apiError } = await api.POST('/v1/auth/roles', {
        body: { role: 'photographer' },
      });
      if (data) {
        updateUser(data.user);
        return;
      }
      setError(t(`mobile.account.profile.errors.${errorKey(apiError)}`));
    } catch {
      setError(t('mobile.account.profile.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="mb-3 gap-2 rounded-md border border-border bg-card p-4">
      <Text className="text-base font-semibold text-foreground">
        {t('mobile.account.profile.title')}
      </Text>
      <Text className="text-sm text-muted-foreground" testID="account-email">
        {t('mobile.account.profile.signedInAs', { email: user.email })}
      </Text>
      <Text className="text-sm text-foreground" testID="account-roles">
        {t('mobile.account.profile.rolesLabel')}:{' '}
        {user.roles.map((role) => t(`mobile.account.profile.roles.${role}`)).join(', ')}
      </Text>
      {error ? (
        <FormNotice tone="error" testID="account-role-error">
          {error}
        </FormNotice>
      ) : null}
      {isPhotographer ? null : (
        <PrimaryButton
          testID="account-become-photographer"
          label={t('mobile.account.profile.becomePhotographer')}
          loading={pending}
          onPress={() => void becomePhotographer()}
        />
      )}
    </View>
  );
}
