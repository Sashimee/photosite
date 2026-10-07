import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { resolveLocale } from '@photoo/shared';

import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/date-format';
import { formatMoney, payoutAmount, requireMoney } from '../../lib/money';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedStudioTranslate,
} from '../../lib/request-errors';
import { FormNotice } from '../form/form-notice';
import { ConfirmAction } from '../requests/confirm-action';
import { StatusBadge, TERMINAL_QUOTE_STATUSES } from '../requests/status-badge';

type Quote = components['schemas']['Quote'];

export function SentQuoteCard({
  quote,
  onWithdrawn,
  onUnauthorized,
}: {
  quote: Quote;
  onWithdrawn: () => void;
  onUnauthorized: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminal = TERMINAL_QUOTE_STATUSES.includes(quote.status);
  const payout = terminal
    ? null
    : payoutAmount(
        requireMoney(quote.subtotal, `quote "${quote.id}" subtotal`),
        requireMoney(quote.platformFee, `quote "${quote.id}" platform fee`),
      );

  async function withdraw() {
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
      } = await api.POST('/v1/quotes/{id}/withdraw', { params: { path: { id: quote.id } } });
      if (data) {
        onWithdrawn();
      } else if (response.status === 401) {
        onUnauthorized();
      } else {
        setError(
          requestErrorMessage(
            scopedStudioTranslate(t, 'quotes'),
            apiErrorWithStatus(apiError, response.status),
          ),
        );
      }
    } catch {
      setError(t('mobile.studio.quotes.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View
      className="gap-2 rounded-lg border border-border bg-card p-4"
      testID={`sent-quote-${quote.id}`}
    >
      <View className="flex-row items-center justify-between gap-2">
        <StatusBadge
          testID={`sent-quote-${quote.id}-status`}
          label={t(`mobile.quotes.status.${quote.status}`)}
          muted={terminal}
        />
        <Text className="font-medium text-foreground">{formatMoney(quote.total, locale)}</Text>
      </View>
      {payout ? (
        <Text className="text-sm text-muted-foreground" testID={`sent-quote-${quote.id}-payout`}>
          {t('mobile.studio.quotes.payoutLabel')} {formatMoney(payout, locale)}
        </Text>
      ) : null}
      <Text className="text-sm text-muted-foreground">
        {t('mobile.studio.quotes.validUntilLabel')} {formatDateTime(quote.validUntil, locale)}
      </Text>
      {quote.message ? <Text className="text-sm text-foreground">{quote.message}</Text> : null}
      {error ? (
        <FormNotice tone="error" testID={`sent-quote-${quote.id}-error`}>
          {error}
        </FormNotice>
      ) : null}
      {quote.status === 'sent' ? (
        <ConfirmAction
          testID={`sent-quote-${quote.id}-withdraw`}
          outline
          triggerLabel={t('mobile.studio.quotes.withdrawCta')}
          title={t('mobile.studio.quotes.withdrawConfirmTitle')}
          description={t('mobile.studio.quotes.withdrawConfirmDescription')}
          confirmLabel={t('mobile.studio.quotes.withdrawConfirmCta')}
          pendingLabel={t('mobile.studio.quotes.withdrawPending')}
          dismissLabel={t('mobile.studio.quotes.withdrawDismissCta')}
          pending={pending}
          onConfirm={withdraw}
        />
      ) : null}
    </View>
  );
}
