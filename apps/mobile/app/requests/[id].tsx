import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { resolveLocale } from '@photoo/shared';

import { FormNotice } from '../../src/components/form/form-notice';
import { ConfirmAction } from '../../src/components/requests/confirm-action';
import { QuoteCard } from '../../src/components/requests/quote-card';
import { StatusBadge, TERMINAL_REQUEST_STATUSES } from '../../src/components/requests/status-badge';
import { RequireSession } from '../../src/components/require-session';
import { api } from '../../src/lib/api';
import { formatDateTime } from '../../src/lib/date-format';
import { formatMoney } from '../../src/lib/money';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedRequestTranslate,
} from '../../src/lib/request-errors';

type Request = components['schemas']['Request'];
type Quote = components['schemas']['Quote'];

const CANCELLABLE_STATUSES: readonly string[] = ['open', 'quoted'];

type LoadState = 'loading' | 'ready' | 'notFound' | 'failed';

function RetryNotice({
  message,
  retryLabel,
  onRetry,
  testID,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  testID: string;
}) {
  return (
    <View className="gap-1" testID={testID} accessibilityRole="alert">
      <Text className="text-sm text-destructive">{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        testID={`${testID}-retry`}
        className="min-h-11 justify-center"
      >
        <Text className="text-sm font-medium text-foreground underline">{retryLabel}</Text>
      </Pressable>
    </View>
  );
}

function RequestDetail({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveLocale(i18n.language);

  const [request, setRequest] = useState<Request | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quotesFailed, setQuotesFailed] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const inFlight = useRef(false);

  const loadQuotes = useCallback(async () => {
    setQuotesFailed(false);
    const data = await api
      .GET('/v1/requests/{requestId}/quotes', { params: { path: { requestId: id } } })
      .then((result) => result.data)
      .catch(() => undefined);
    if (data) {
      setQuotes(data.items);
    } else {
      setQuotesFailed(true);
    }
  }, [id]);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const { data, response } = await api.GET('/v1/requests/{id}', {
        params: { path: { id } },
      });
      if (data) {
        setRequest(data);
        setLoadState('ready');
        void loadQuotes();
      } else {
        setLoadState(response.status === 404 || response.status === 403 ? 'notFound' : 'failed');
      }
    } catch {
      setLoadState('failed');
    }
  }, [id, loadQuotes]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelRequest() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setIsCancelling(true);
    setCancelError(null);
    try {
      const { data, error, response } = await api.POST('/v1/requests/{id}/cancel', {
        params: { path: { id } },
      });
      if (data) {
        setRequest(data);
      } else {
        setCancelError(
          requestErrorMessage(
            scopedRequestTranslate(t),
            apiErrorWithStatus(error, response.status),
          ),
        );
      }
    } catch {
      setCancelError(t('mobile.requests.detail.cancelFailed'));
    } finally {
      inFlight.current = false;
      setIsCancelling(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator testID="request-detail-loading" />
      </View>
    );
  }

  if (loadState === 'notFound' || loadState === 'failed' || !request) {
    return (
      <View className="flex-1 justify-center gap-4 bg-background px-6">
        {loadState === 'notFound' ? (
          <FormNotice tone="error" testID="request-detail-not-found">
            {t('mobile.requests.detail.notFound')}
          </FormNotice>
        ) : (
          <RetryNotice
            testID="request-detail-error"
            message={t('mobile.requests.detail.loadFailed')}
            retryLabel={t('mobile.requests.detail.retry')}
            onRetry={() => void load()}
          />
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.back();
          }}
          testID="request-detail-back"
          className="min-h-11 items-center justify-center"
        >
          <Text className="text-sm font-medium text-foreground underline">
            {t('mobile.requests.detail.back')}
          </Text>
        </Pressable>
      </View>
    );
  }

  const address = [
    request.address.line1,
    request.address.line2,
    `${request.address.postalCode} ${request.address.city}`,
    request.address.countryCode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <ScrollView contentContainerClassName="gap-5 px-6 py-12" testID="request-detail">
      <View className="gap-2">
        <StatusBadge
          testID="request-detail-status"
          label={t(`mobile.requests.status.${request.status}`)}
          muted={TERMINAL_REQUEST_STATUSES.includes(request.status)}
        />
        <Text className="text-2xl font-semibold text-foreground">{request.title}</Text>
        <Text className="text-foreground">{request.description}</Text>
      </View>

      <View className="gap-1">
        <Text className="text-sm text-muted-foreground">
          {t('mobile.requests.detail.eventDateLabel')}
        </Text>
        <Text className="text-foreground">{formatDateTime(request.eventDate, locale)}</Text>
        <Text className="mt-2 text-sm text-muted-foreground">
          {t('mobile.requests.detail.budgetLabel')}
        </Text>
        <Text className="text-foreground" testID="request-detail-budget">
          {t('mobile.requests.detail.budgetRange', {
            min: formatMoney(request.budgetMin, locale),
            max: formatMoney(request.budgetMax, locale),
          })}
        </Text>
        <Text className="mt-2 text-sm text-muted-foreground">
          {t('mobile.requests.detail.usageLabel')}
        </Text>
        <Text className="text-foreground">{t(`common.licenceUsages.${request.usage}`)}</Text>
        <Text className="mt-2 text-sm text-muted-foreground">
          {t('mobile.requests.detail.addressLabel')}
        </Text>
        <Text className="text-foreground">{address}</Text>
      </View>

      {request.status === 'cancelled' ? (
        <FormNotice tone="info" testID="request-detail-cancelled">
          {t('mobile.requests.detail.cancelledNotice')}
        </FormNotice>
      ) : null}

      {cancelError ? (
        <FormNotice tone="error" testID="request-detail-cancel-error">
          {cancelError}
        </FormNotice>
      ) : null}

      {CANCELLABLE_STATUSES.includes(request.status) ? (
        <ConfirmAction
          testID="request-cancel-action"
          outline
          triggerLabel={t('mobile.requests.detail.cancelCta')}
          title={t('mobile.requests.detail.cancelConfirmTitle')}
          description={t('mobile.requests.detail.cancelConfirmDescription')}
          confirmLabel={t('mobile.requests.detail.cancelConfirmCta')}
          pendingLabel={t('mobile.requests.detail.cancelPending')}
          dismissLabel={t('mobile.requests.detail.cancelDismissCta')}
          pending={isCancelling}
          onConfirm={cancelRequest}
        />
      ) : null}

      <View className="gap-3">
        <Text className="text-lg font-semibold text-foreground">
          {t('mobile.requests.detail.quotesHeading')}
        </Text>
        {quotesFailed ? (
          <RetryNotice
            testID="request-quotes-error"
            message={t('mobile.requests.detail.quotesFailed')}
            retryLabel={t('mobile.requests.detail.retry')}
            onRetry={() => void loadQuotes()}
          />
        ) : quotes.length === 0 ? (
          <Text className="text-muted-foreground" testID="request-quotes-empty">
            {t('mobile.requests.detail.noQuotes')}
          </Text>
        ) : (
          quotes.map((quote) => <QuoteCard key={quote.id} quote={quote} />)
        )}
      </View>
    </ScrollView>
  );
}

export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RequireSession>
      <RequestDetail id={id} />
    </RequireSession>
  );
}
