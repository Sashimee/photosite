import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { resolveLocale } from '@photoo/shared';

import { formatDateTime } from '../../lib/date-format';
import { formatMoney } from '../../lib/money';
import { StatusBadge, TERMINAL_REQUEST_STATUSES } from '../requests/status-badge';

type RequestSummary = components['schemas']['RequestSummary'];

export function IncomingRequestSummary({
  request,
  testIDPrefix,
}: {
  request: RequestSummary;
  testIDPrefix: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-base font-semibold text-foreground">
          {t(`common.categories.${request.category}`)}
        </Text>
        <View className="flex-row items-center gap-2">
          {request.hasQuoted ? (
            <StatusBadge
              testID={`${testIDPrefix}-quoted`}
              label={t('mobile.studio.requests.alreadyQuotedLabel')}
              muted
            />
          ) : null}
          <StatusBadge
            testID={`${testIDPrefix}-status`}
            label={t(`mobile.requests.status.${request.status}`)}
            muted={TERMINAL_REQUEST_STATUSES.includes(request.status)}
          />
        </View>
      </View>
      <Text className="text-base text-foreground">{request.title}</Text>
      <Text className="text-sm text-muted-foreground">
        {formatDateTime(request.eventDate, locale)}
        {' · '}
        {request.city}, {request.countryCode}
      </Text>
      <Text className="text-sm text-muted-foreground" testID={`${testIDPrefix}-budget`}>
        {t('mobile.requests.detail.budgetRange', {
          min: formatMoney(request.budgetMin, locale),
          max: formatMoney(request.budgetMax, locale),
        })}
        {' · '}
        {t(`common.licenceUsages.${request.usage}`)}
      </Text>
    </View>
  );
}
