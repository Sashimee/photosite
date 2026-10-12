import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { resolveLocale } from '@photoo/shared';

import { FormNotice } from '../../../src/components/form/form-notice';
import { IncomingRequestSummary } from '../../../src/components/studio/incoming-request-summary';
import { SendQuoteForm } from '../../../src/components/studio/send-quote-form';
import {
  StudioFrame,
  StudioLoading,
  StudioMessage,
} from '../../../src/components/studio/studio-frame';
import { formatDateTime } from '../../../src/lib/date-format';
import { canQuoteRequest, useIncomingRequest } from '../../../src/lib/use-incoming-request';

function IncomingRequestDetail({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const { state, reload } = useIncomingRequest(id);

  switch (state.status) {
    case 'loading':
      return <StudioLoading testID="incoming-request-loading" />;
    case 'unauthorized':
      return (
        <StudioMessage
          testID="incoming-request-unauthorized"
          message={t('mobile.studio.sessionExpired')}
        />
      );
    case 'notFound':
      return (
        <StudioMessage
          testID="incoming-request-not-found"
          message={t('mobile.studio.requests.notFound')}
        />
      );
    case 'error':
      return (
        <StudioMessage
          testID="incoming-request-error"
          message={t('mobile.studio.loadFailed')}
          actionLabel={t('mobile.studio.retry')}
          actionTestID="incoming-request-retry"
          onAction={reload}
        />
      );
    case 'ready': {
      const { request } = state;
      return (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerClassName="gap-5 px-6 pb-12"
            keyboardShouldPersistTaps="handled"
            testID="incoming-request-detail"
          >
            <IncomingRequestSummary request={request} testIDPrefix="incoming-request-detail" />
            <Text className="text-foreground">{request.description}</Text>
            {request.dateFlexible ? (
              <Text className="text-sm text-muted-foreground">
                {t('mobile.studio.requests.dateFlexible')}
              </Text>
            ) : null}
            {request.expiresAt ? (
              <View className="gap-1">
                <Text className="text-sm text-muted-foreground">
                  {t('mobile.studio.requests.expiresLabel')}
                </Text>
                <Text className="text-foreground">{formatDateTime(request.expiresAt, locale)}</Text>
              </View>
            ) : null}
            {canQuoteRequest(request) ? (
              <SendQuoteForm request={request} />
            ) : (
              <FormNotice tone="info" testID="incoming-request-not-quotable">
                {request.hasQuoted
                  ? t('mobile.studio.requests.alreadyQuotedNotice')
                  : t('mobile.studio.requests.expiredNotice')}
              </FormNotice>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }
  }
}

export default function StudioRequestDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <StudioFrame title={t('mobile.studio.requests.detailTitle')}>
      <IncomingRequestDetail id={id} />
    </StudioFrame>
  );
}
