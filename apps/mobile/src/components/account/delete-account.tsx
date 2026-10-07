import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { dataRequestError, dataRequestErrorWithStatus } from '../../lib/data-requests';
import { FormNotice } from '../form/form-notice';
import { ConfirmAction } from '../requests/confirm-action';

export function DeleteAccount() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const {
        data,
        error: apiError,
        response,
      } = await api.POST('/v1/me/data-requests', { body: { type: 'delete' } });
      if (!data) {
        const failure = dataRequestError(dataRequestErrorWithStatus(apiError, response.status));
        setError(
          failure.seconds === undefined
            ? t(`mobile.account.deletion.errors.${failure.key}`)
            : t('mobile.account.deletion.errors.tooManyRequestsWithRetry', {
                seconds: failure.seconds,
              }),
        );
        return;
      }
      await signOut();
    } catch {
      setError(t('mobile.account.deletion.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="mt-3 gap-3">
      {error ? (
        <FormNotice tone="error" testID="account-deletion-error">
          {error}
        </FormNotice>
      ) : null}
      <ConfirmAction
        outline
        testID="account-deletion"
        triggerLabel={t('mobile.account.deletion.cta')}
        title={t('mobile.account.deletion.confirmTitle')}
        description={t('mobile.account.deletion.confirmDescription')}
        confirmLabel={t('mobile.account.deletion.confirmCta')}
        pendingLabel={t('mobile.account.deletion.pending')}
        dismissLabel={t('mobile.account.deletion.dismissCta')}
        pending={pending}
        onConfirm={deleteAccount}
      />
    </View>
  );
}
