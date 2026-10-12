import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { SUPPORTED_LOCALES, isLocale, type Locale } from '@photoo/shared';

import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { FormNotice } from '../form/form-notice';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { status, user, updateUser } = useAuth();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deviceLocale = isLocale(i18n.language) ? i18n.language : null;
  const current = status === 'signed-in' && user ? user.locale : deviceLocale;

  async function select(locale: Locale) {
    if (inFlight.current || locale === current) {
      return;
    }
    setError(null);
    if (status === 'signed-out') {
      await i18n.changeLanguage(locale);
      return;
    }
    if (status !== 'signed-in') {
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      const { data, error: apiError } = await api.PATCH('/v1/me/locale', { body: { locale } });
      if (data) {
        updateUser(data.user);
        await i18n.changeLanguage(locale);
        return;
      }
      setError(
        t(
          apiError.code === 'UNAUTHORIZED'
            ? 'mobile.account.language.errors.unauthorized'
            : 'mobile.account.language.errors.generic',
        ),
      );
    } catch {
      setError(t('mobile.account.language.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="mb-3 gap-2 rounded-md border border-border bg-card p-4">
      <Text className="text-base font-semibold text-foreground">
        {t('mobile.account.language.title')}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {SUPPORTED_LOCALES.map((code) => {
          const selected = current === code;
          return (
            <Pressable
              key={code}
              testID={`account-locale-${code}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: pending }}
              disabled={pending}
              onPress={() => void select(code)}
              className={`rounded-md border px-3 py-1.5 ${selected ? 'border-primary bg-primary' : 'border-input bg-background'} ${pending ? 'opacity-50' : ''}`}
            >
              <Text className={selected ? 'text-primary-foreground' : 'text-foreground'}>
                {t(`locale.${code}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <FormNotice tone="error" testID="account-language-error">
          {error}
        </FormNotice>
      ) : null}
    </View>
  );
}
