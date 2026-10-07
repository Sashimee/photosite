import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { FormNotice } from '../form/form-notice';
import { ConfirmAction } from '../requests/confirm-action';
import { PrimaryButton } from '../form/primary-button';

export function SignOut() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [everywherePending, setEverywherePending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOutHere() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await api.POST('/v1/auth/sign-out').catch(() => undefined);
      await signOut();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function signOutEverywhere() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setEverywherePending(true);
    setError(null);
    try {
      const { response } = await api.POST('/v1/auth/sessions/revoke-all');
      if (!response.ok && response.status !== 401) {
        setError(t('mobile.account.session.errors.generic'));
        return;
      }
      await signOut();
    } catch {
      setError(t('mobile.account.session.errors.generic'));
    } finally {
      inFlight.current = false;
      setEverywherePending(false);
    }
  }

  return (
    <View className="mt-3 gap-3">
      {error ? (
        <FormNotice tone="error" testID="account-sign-out-error">
          {error}
        </FormNotice>
      ) : null}
      <PrimaryButton
        testID="account-sign-out"
        label={
          pending ? t('mobile.account.session.signingOut') : t('mobile.account.session.signOut')
        }
        loading={pending}
        disabled={everywherePending}
        onPress={() => void signOutHere()}
      />
      <ConfirmAction
        outline
        testID="account-sign-out-everywhere"
        triggerLabel={t('mobile.account.session.signOutEverywhere')}
        title={t('mobile.account.session.signOutEverywhereTitle')}
        description={t('mobile.account.session.signOutEverywhereDescription')}
        confirmLabel={t('mobile.account.session.signOutEverywhereConfirm')}
        pendingLabel={t('mobile.account.session.signOutEverywherePending')}
        dismissLabel={t('mobile.account.session.dismiss')}
        pending={everywherePending}
        disabled={pending}
        onConfirm={signOutEverywhere}
      />
    </View>
  );
}
