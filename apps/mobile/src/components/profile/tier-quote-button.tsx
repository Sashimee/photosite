import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedQuoteTranslate,
} from '../../lib/request-errors';
import { signInHref } from '../../lib/return-path';

export function TierQuoteButton({
  slug,
  productId,
  tierId,
  accessibilityLabel,
}: {
  slug: string;
  productId: string;
  tierId: string;
  accessibilityLabel: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { status } = useAuth();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePress() {
    if (inFlight.current) {
      return;
    }
    if (status !== 'signed-in') {
      router.push(signInHref(`/photographers/${slug}`));
      return;
    }

    inFlight.current = true;
    setPending(true);
    setError(null);
    const result = await api
      .POST('/v1/photographers/{slug}/products/{productId}/quotes', {
        params: { path: { slug, productId } },
        body: { productTierId: tierId },
      })
      .catch(() => null);
    inFlight.current = false;
    setPending(false);

    if (!result) {
      setError(requestErrorMessage(scopedQuoteTranslate(t), undefined));
    } else if (result.error) {
      setError(
        requestErrorMessage(
          scopedQuoteTranslate(t),
          apiErrorWithStatus(result.error, result.response.status),
        ),
      );
    } else {
      router.push({ pathname: '/quotes/[id]', params: { id: result.data.id } });
    }
  }

  return (
    <View className="items-end gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: pending || status === 'loading' }}
        disabled={pending || status === 'loading'}
        onPress={() => void handlePress()}
        testID={`tier-quote-${tierId}`}
        className={`min-h-11 justify-center rounded-md border border-border px-3 ${pending || status === 'loading' ? 'opacity-50' : ''}`}
      >
        <Text className="text-sm font-medium text-foreground">
          {pending ? t('mobile.profile.requestingTierQuote') : t('mobile.profile.requestTierQuote')}
        </Text>
      </Pressable>
      {error ? (
        <Text className="text-sm text-destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
