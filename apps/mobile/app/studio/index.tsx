import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { StudioFrame } from '../../src/components/studio/studio-frame';

function HubEntry({
  title,
  description,
  href,
  testID,
}: {
  title: string;
  description: string;
  href: Href;
  testID: string;
}) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push(href);
      }}
      testID={testID}
      className="min-h-11 gap-1 rounded-md border border-border bg-card p-4"
    >
      <Text className="text-base font-semibold text-foreground">{title}</Text>
      <Text className="text-sm text-muted-foreground">{description}</Text>
    </Pressable>
  );
}

export default function StudioHomeScreen() {
  const { t } = useTranslation();

  return (
    <StudioFrame title={t('mobile.studio.title')}>
      <ScrollView contentContainerClassName="gap-3 px-6 pb-6">
        <Text className="text-muted-foreground">{t('mobile.studio.intro')}</Text>
        <View className="gap-3">
          <HubEntry
            testID="studio-entry-profile"
            title={t('mobile.studio.hub.profileTitle')}
            description={t('mobile.studio.hub.profileDescription')}
            href="/studio/profile"
          />
          <HubEntry
            testID="studio-entry-portfolio"
            title={t('mobile.studio.hub.portfolioTitle')}
            description={t('mobile.studio.hub.portfolioDescription')}
            href="/studio/portfolio"
          />
          <HubEntry
            testID="studio-entry-products"
            title={t('mobile.studio.hub.productsTitle')}
            description={t('mobile.studio.hub.productsDescription')}
            href="/studio/products"
          />
          <HubEntry
            testID="studio-entry-verification"
            title={t('mobile.studio.hub.verificationTitle')}
            description={t('mobile.studio.hub.verificationDescription')}
            href="/studio/verification"
          />
          <HubEntry
            testID="studio-entry-requests"
            title={t('mobile.studio.hub.requestsTitle')}
            description={t('mobile.studio.hub.requestsDescription')}
            href="/studio/requests"
          />
          <HubEntry
            testID="studio-entry-quotes"
            title={t('mobile.studio.hub.quotesTitle')}
            description={t('mobile.studio.hub.quotesDescription')}
            href="/studio/quotes"
          />
          <HubEntry
            testID="studio-entry-payouts"
            title={t('mobile.studio.hub.payoutsTitle')}
            description={t('mobile.studio.hub.payoutsDescription')}
            href="/studio/payouts"
          />
        </View>
      </ScrollView>
    </StudioFrame>
  );
}
