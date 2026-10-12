import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { api } from '../../lib/api';
import {
  dataRequestError,
  dataRequestErrorWithStatus,
  exportState,
  latestExport,
  type DataRequest,
} from '../../lib/data-requests';
import { isHttpsUrl } from '../../lib/payouts';
import { FormNotice } from '../form/form-notice';
import { PrimaryButton } from '../form/primary-button';

type Action = 'refresh' | 'request' | 'download';

export function DataExport() {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [request, setRequest] = useState<DataRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const failureMessage = useCallback(
    (apiError: Parameters<typeof dataRequestErrorWithStatus>[0], status: number) => {
      const failure = dataRequestError(dataRequestErrorWithStatus(apiError, status));
      return failure.seconds === undefined
        ? t(`mobile.account.export.errors.${failure.key}`)
        : t('mobile.account.export.errors.tooManyRequestsWithRetry', { seconds: failure.seconds });
    },
    [t],
  );

  const run = useCallback(
    async (next: Action, work: () => Promise<void>) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setAction(next);
      setError(null);
      try {
        await work();
      } catch {
        setError(t('mobile.account.export.errors.generic'));
      } finally {
        inFlight.current = false;
        setAction(null);
      }
    },
    [t],
  );

  const refresh = useCallback(
    () =>
      run('refresh', async () => {
        const { data, error: apiError, response } = await api.GET('/v1/me/data-requests');
        if (!data) {
          setError(failureMessage(apiError, response.status));
          return;
        }
        setRequest(latestExport(data));
        setLoaded(true);
      }),
    [run, failureMessage],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const requestExport = () =>
    run('request', async () => {
      const {
        data,
        error: apiError,
        response,
      } = await api.POST('/v1/me/data-requests', { body: { type: 'export' } });
      if (!data) {
        setError(failureMessage(apiError, response.status));
        return;
      }
      setRequest(data);
      setLoaded(true);
    });

  const download = (id: string) =>
    run('download', async () => {
      const {
        data,
        error: apiError,
        response,
      } = await api.GET('/v1/me/data-requests/{id}/download', { params: { path: { id } } });
      if (!data) {
        setError(failureMessage(apiError, response.status));
        return;
      }
      if (!isHttpsUrl(data.url)) {
        setError(t('mobile.account.export.errors.generic'));
        return;
      }
      await WebBrowser.openBrowserAsync(data.url);
    });

  const state = exportState(request, Date.now());
  const busy = action !== null;
  const canRequest = loaded && (state === 'none' || state === 'failed' || state === 'expired');

  return (
    <View
      className="mt-3 gap-3 rounded-md border border-border bg-card p-4"
      testID="account-export"
    >
      <Text className="text-base font-semibold text-foreground">
        {t('mobile.account.export.title')}
      </Text>
      <Text className="text-sm text-muted-foreground">
        {t('mobile.account.export.description')}
      </Text>
      {loaded ? (
        <Text className="text-sm text-foreground" testID="account-export-status">
          {t(`mobile.account.export.status.${state}`)}
        </Text>
      ) : null}
      {error ? (
        <FormNotice tone="error" testID="account-export-error">
          {error}
        </FormNotice>
      ) : null}
      {canRequest ? (
        <PrimaryButton
          testID="account-export-request"
          label={
            action === 'request'
              ? t('mobile.account.export.requesting')
              : t('mobile.account.export.requestCta')
          }
          loading={action === 'request'}
          disabled={busy}
          onPress={() => void requestExport()}
        />
      ) : null}
      {state === 'ready' && request ? (
        <PrimaryButton
          testID="account-export-download"
          label={
            action === 'download'
              ? t('mobile.account.export.opening')
              : t('mobile.account.export.downloadCta')
          }
          loading={action === 'download'}
          disabled={busy}
          onPress={() => void download(request.id)}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void refresh()}
        testID="account-export-refresh"
        className="min-h-11 items-center justify-center"
      >
        <Text className="text-sm font-medium text-foreground underline">
          {t('mobile.account.export.refreshCta')}
        </Text>
      </Pressable>
    </View>
  );
}
