import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProductEditorState } from '../../lib/use-product-editor';
import { StudioLoading, StudioMessage } from './studio-frame';

export function ProductEditorStates({
  state,
  reload,
  children,
}: {
  state: ProductEditorState;
  reload: () => void;
  children: (ready: Extract<ProductEditorState, { status: 'ready' }>) => ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  switch (state.status) {
    case 'loading':
      return <StudioLoading testID="product-loading" />;
    case 'unauthorized':
      return (
        <StudioMessage testID="product-unauthorized" message={t('mobile.studio.sessionExpired')} />
      );
    case 'notFound':
      return (
        <StudioMessage
          testID="product-not-found"
          message={t('mobile.studio.products.errors.notFound')}
        />
      );
    case 'error':
      return (
        <StudioMessage
          testID="product-load-error"
          message={t('mobile.studio.loadFailed')}
          actionLabel={t('mobile.studio.retry')}
          actionTestID="product-retry"
          onAction={reload}
        />
      );
    case 'missing':
      return (
        <StudioMessage
          testID="product-needs-profile"
          tone="info"
          message={`${t('mobile.studio.products.needsProfileTitle')}. ${t('mobile.studio.products.needsProfileDescription')}`}
          actionLabel={t('mobile.studio.products.needsProfileCta')}
          actionTestID="product-create-profile"
          onAction={() => {
            router.push('/studio/profile');
          }}
        />
      );
    case 'ready':
      return children(state);
  }
}
