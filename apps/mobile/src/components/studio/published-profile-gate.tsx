import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useOwnPhotographerProfile } from '../../lib/use-own-photographer-profile';
import { StudioLoading, StudioMessage } from './studio-frame';

export function PublishedProfileGate({
  scope,
  children,
}: {
  scope: 'requests' | 'quotes';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, reload } = useOwnPhotographerProfile();

  switch (state.status) {
    case 'loading':
      return <StudioLoading testID={`${scope}-profile-loading`} />;
    case 'unauthorized':
      return (
        <StudioMessage
          testID={`${scope}-unauthorized`}
          message={t('mobile.studio.sessionExpired')}
        />
      );
    case 'error':
      return (
        <StudioMessage
          testID={`${scope}-profile-error`}
          message={t('mobile.studio.loadFailed')}
          actionLabel={t('mobile.studio.retry')}
          actionTestID={`${scope}-profile-retry`}
          onAction={reload}
        />
      );
    case 'missing':
      return (
        <StudioMessage
          testID={`${scope}-needs-profile`}
          tone="info"
          message={`${t(`mobile.studio.${scope}.needsProfileTitle`)}. ${t(`mobile.studio.${scope}.needsProfileDescription`)}`}
          actionLabel={t(`mobile.studio.${scope}.needsProfileCta`)}
          actionTestID={`${scope}-create-profile`}
          onAction={() => {
            router.push('/studio/profile');
          }}
        />
      );
    case 'ready':
      if (!state.profile.isPublished) {
        return (
          <StudioMessage
            testID={`${scope}-needs-published`}
            tone="info"
            message={`${t(`mobile.studio.${scope}.needsPublishedTitle`)}. ${t(`mobile.studio.${scope}.needsPublishedDescription`)}`}
            actionLabel={t(`mobile.studio.${scope}.needsPublishedCta`)}
            actionTestID={`${scope}-open-profile`}
            onAction={() => {
              router.push('/studio/profile');
            }}
          />
        );
      }
      return children;
  }
}
