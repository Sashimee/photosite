import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, ScrollView, Text, View, type NativeEventSubscription } from 'react-native';

import type { components } from '@photoo/api-client';

import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import {
  StudioFrame,
  StudioLoading,
  StudioMessage,
} from '../../src/components/studio/studio-frame';
import { api } from '../../src/lib/api';
import type { ApiErrorLike } from '../../src/lib/auth-errors';
import { isHttpsUrl, payoutsState } from '../../src/lib/payouts';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedStudioTranslate,
} from '../../src/lib/request-errors';
import { useOwnPhotographerProfile } from '../../src/lib/use-own-photographer-profile';

type OwnPhotographerProfile = components['schemas']['OwnPhotographerProfile'];

function PayoutsPanel({
  profile,
  returned,
  onOpened,
  onRefresh,
}: {
  profile: OwnPhotographerProfile;
  returned: boolean;
  onOpened: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const returnSubscription = useRef<NativeEventSubscription | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const translate = scopedStudioTranslate(t, 'payouts');
  const state = payoutsState(profile);

  useEffect(
    () => () => {
      returnSubscription.current?.remove();
    },
    [],
  );

  function onReturnToApp() {
    returnSubscription.current?.remove();
    returnSubscription.current = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        returnSubscription.current?.remove();
        returnSubscription.current = null;
        onOpened();
      }
    });
  }

  function failureMessage(apiError: ApiErrorLike | undefined, status: number) {
    return apiError?.code === 'EMAIL_NOT_VERIFIED'
      ? t('mobile.studio.payouts.errors.emailNotVerified')
      : requestErrorMessage(translate, apiErrorWithStatus(apiError, status));
  }

  async function start() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const account = await api.POST('/v1/me/stripe/account');
      if (account.error) {
        setError(failureMessage(account.error, account.response.status));
        return;
      }
      const link = await api.POST('/v1/me/stripe/account-link');
      if (link.error) {
        setError(failureMessage(link.error, link.response.status));
        return;
      }
      const url: unknown = link.data.url;
      if (!isHttpsUrl(url)) {
        setError(t('mobile.studio.payouts.errors.generic'));
        return;
      }
      const result = await WebBrowser.openBrowserAsync(url);
      if (
        result.type === WebBrowser.WebBrowserResultType.CANCEL ||
        result.type === WebBrowser.WebBrowserResultType.DISMISS
      ) {
        onOpened();
      } else if (result.type === WebBrowser.WebBrowserResultType.OPENED) {
        onReturnToApp();
      } else {
        setError(t('mobile.studio.payouts.errors.generic'));
      }
    } catch {
      setError(t('mobile.studio.payouts.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="gap-3 rounded-md border border-border p-4" testID="payouts-panel">
      <Text className="text-lg font-semibold text-foreground" testID="payouts-status">
        {t(`mobile.studio.payouts.status.${state}`)}
      </Text>
      <Text className="text-sm text-foreground" testID="payouts-description">
        {t(`mobile.studio.payouts.description.${state}`)}
      </Text>
      {returned && state !== 'enabled' ? (
        <FormNotice tone="info" testID="payouts-returned">
          {t('mobile.studio.payouts.returnedNotice')}
        </FormNotice>
      ) : null}
      {error ? (
        <FormNotice tone="error" testID="payouts-error">
          {error}
        </FormNotice>
      ) : null}
      {state === 'enabled' ? null : (
        <PrimaryButton
          testID="payouts-start"
          label={t(
            pending
              ? 'mobile.studio.payouts.pending'
              : state === 'incomplete'
                ? 'mobile.studio.payouts.continueCta'
                : 'mobile.studio.payouts.setupCta',
          )}
          loading={pending}
          onPress={() => void start()}
        />
      )}
      {returned && state !== 'enabled' ? (
        <PrimaryButton
          testID="payouts-refresh"
          label={t('mobile.studio.payouts.refreshCta')}
          disabled={pending}
          onPress={onRefresh}
        />
      ) : null}
    </View>
  );
}

function PayoutsContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, reload } = useOwnPhotographerProfile();
  const [returned, setReturned] = useState(false);

  function handleOpened() {
    setReturned(true);
    reload();
  }

  if (state.status === 'loading') {
    return <StudioLoading testID="payouts-loading" />;
  }
  if (state.status === 'unauthorized') {
    return (
      <StudioMessage testID="payouts-unauthorized" message={t('mobile.studio.sessionExpired')} />
    );
  }
  if (state.status === 'error') {
    return (
      <StudioMessage
        testID="payouts-load-error"
        message={t('mobile.studio.loadFailed')}
        actionLabel={t('mobile.studio.retry')}
        actionTestID="payouts-retry"
        onAction={reload}
      />
    );
  }
  if (state.status === 'missing') {
    return (
      <StudioMessage
        testID="payouts-needs-profile"
        tone="info"
        message={`${t('mobile.studio.payouts.needsProfileTitle')}. ${t('mobile.studio.payouts.needsProfileDescription')}`}
        actionLabel={t('mobile.studio.payouts.needsProfileCta')}
        actionTestID="payouts-create-profile"
        onAction={() => {
          router.push('/studio/profile');
        }}
      />
    );
  }

  return (
    <ScrollView contentContainerClassName="gap-4 px-6 pb-6">
      <Text className="text-muted-foreground">{t('mobile.studio.payouts.intro')}</Text>
      <PayoutsPanel
        profile={state.profile}
        returned={returned}
        onOpened={handleOpened}
        onRefresh={reload}
      />
    </ScrollView>
  );
}

export default function StudioPayoutsScreen() {
  const { t } = useTranslation();

  return (
    <StudioFrame title={t('mobile.studio.payouts.title')}>
      <PayoutsContent />
    </StudioFrame>
  );
}
