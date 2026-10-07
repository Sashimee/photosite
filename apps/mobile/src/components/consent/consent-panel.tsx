import type { ConsentCategoryGrants } from '@photoo/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

const BUTTON_CLASS = 'items-center rounded-md border border-border bg-card px-4 py-3';
const BUTTON_TEXT_CLASS = 'text-base font-medium text-foreground';

function Toggle({
  testID,
  label,
  value,
  onValueChange,
}: {
  testID: string;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      testID={testID}
      onPress={() => {
        onValueChange(!value);
      }}
      className={`h-8 w-14 justify-center rounded-full border border-border px-1 ${value ? 'items-end bg-primary' : 'items-start bg-muted'}`}
    >
      <View className="h-6 w-6 rounded-full bg-card" />
    </Pressable>
  );
}

function CategoryRow({
  title,
  description,
  trailing,
}: {
  title: string;
  description: string;
  trailing: React.ReactNode;
}) {
  return (
    <View className="flex-row items-start gap-3 rounded-md border border-border bg-card p-4">
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-foreground">{title}</Text>
        <Text className="text-sm text-muted-foreground">{description}</Text>
      </View>
      {trailing}
    </View>
  );
}

export function ConsentPanel({
  initial,
  onDecide,
  notice,
}: {
  initial: ConsentCategoryGrants;
  onDecide: (categories: ConsentCategoryGrants) => void;
  notice?: string | null;
}) {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<ConsentCategoryGrants>(initial);

  return (
    <ScrollView contentContainerClassName="gap-4 p-6 pt-12" testID="consent-panel">
      <Text className="text-2xl font-semibold text-foreground">{t('mobile.consent.title')}</Text>
      <Text className="text-base text-muted-foreground">{t('mobile.consent.intro')}</Text>
      {notice ? (
        <Text className="text-sm text-muted-foreground" testID="consent-notice">
          {notice}
        </Text>
      ) : null}
      <CategoryRow
        title={t('mobile.consent.necessary.title')}
        description={t('mobile.consent.necessary.description')}
        trailing={
          <Text className="text-sm text-muted-foreground">{t('mobile.consent.alwaysOn')}</Text>
        }
      />
      <CategoryRow
        title={t('mobile.consent.analytics.title')}
        description={t('mobile.consent.analytics.description')}
        trailing={
          <Toggle
            testID="consent-analytics"
            label={t('mobile.consent.analytics.title')}
            value={grants.analytics}
            onValueChange={(analytics) => {
              setGrants((current) => ({ ...current, analytics }));
            }}
          />
        }
      />
      <CategoryRow
        title={t('mobile.consent.adsMarketing.title')}
        description={t('mobile.consent.adsMarketing.description')}
        trailing={
          <Toggle
            testID="consent-ads-marketing"
            label={t('mobile.consent.adsMarketing.title')}
            value={grants.adsMarketing}
            onValueChange={(adsMarketing) => {
              setGrants((current) => ({ ...current, adsMarketing }));
            }}
          />
        }
      />
      <View className="gap-3 pt-2">
        <Pressable
          accessibilityRole="button"
          testID="consent-accept-all"
          className={BUTTON_CLASS}
          onPress={() => {
            onDecide({ analytics: true, adsMarketing: true });
          }}
        >
          <Text className={BUTTON_TEXT_CLASS}>{t('mobile.consent.acceptAll')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID="consent-decline-all"
          className={BUTTON_CLASS}
          onPress={() => {
            onDecide({ analytics: false, adsMarketing: false });
          }}
        >
          <Text className={BUTTON_TEXT_CLASS}>{t('mobile.consent.declineAll')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID="consent-save"
          className={BUTTON_CLASS}
          onPress={() => {
            onDecide(grants);
          }}
        >
          <Text className={BUTTON_TEXT_CLASS}>{t('mobile.consent.save')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
