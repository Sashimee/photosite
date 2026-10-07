import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { components } from '@photoo/api-client';

import { api } from '../../lib/api';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedQuoteTranslate,
} from '../../lib/request-errors';
import { FormNotice } from '../form/form-notice';
import { ConfirmAction } from './confirm-action';

type Quote = components['schemas']['Quote'];
type Action = 'accept' | 'decline';

export function QuoteActions({
  quote,
  onChanged,
}: {
  quote: Quote;
  onChanged: (quote: Quote, action: Action) => void;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (quote.status !== 'sent') {
    return null;
  }

  async function run(action: Action) {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(action);
    setError(null);
    try {
      const path = action === 'accept' ? '/v1/quotes/{id}/accept' : '/v1/quotes/{id}/decline';
      const {
        data,
        error: apiError,
        response,
      } = await api.POST(path, {
        params: { path: { id: quote.id } },
      });
      if (data) {
        onChanged(data, action);
      } else {
        setError(
          requestErrorMessage(
            scopedQuoteTranslate(t),
            apiErrorWithStatus(apiError, response.status),
          ),
        );
      }
    } catch {
      setError(t('mobile.quotes.errors.actionFailed'));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  const expired = new Date(quote.validUntil).getTime() < Date.now();

  return (
    <View className="gap-3">
      {error ? (
        <FormNotice tone="error" testID="quote-action-error">
          {error}
        </FormNotice>
      ) : null}
      <ConfirmAction
        testID="quote-accept"
        triggerLabel={t('mobile.quotes.detail.acceptCta')}
        title={t('mobile.quotes.detail.acceptConfirmTitle')}
        description={t('mobile.quotes.detail.acceptConfirmDescription')}
        confirmLabel={t('mobile.quotes.detail.acceptConfirmCta')}
        pendingLabel={t('mobile.quotes.detail.acceptPending')}
        dismissLabel={t('mobile.quotes.detail.acceptDismissCta')}
        disabled={expired || pending === 'decline'}
        pending={pending === 'accept'}
        onConfirm={() => run('accept')}
      />
      <ConfirmAction
        testID="quote-decline"
        outline
        triggerLabel={t('mobile.quotes.detail.declineCta')}
        title={t('mobile.quotes.detail.declineConfirmTitle')}
        description={t('mobile.quotes.detail.declineConfirmDescription')}
        confirmLabel={t('mobile.quotes.detail.declineConfirmCta')}
        pendingLabel={t('mobile.quotes.detail.declinePending')}
        dismissLabel={t('mobile.quotes.detail.declineDismissCta')}
        disabled={pending === 'accept'}
        pending={pending === 'decline'}
        onConfirm={() => run('decline')}
      />
    </View>
  );
}
