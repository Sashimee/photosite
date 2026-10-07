import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { PHOTOGRAPHER_CATEGORIES, resolveLocale } from '@photoo/shared';

import { PrimaryButton } from '../../src/components/form/primary-button';
import { PortfolioGrid } from '../../src/components/profile/portfolio-grid';
import { ProductList } from '../../src/components/profile/product-list';
import { useAuth } from '../../src/lib/auth-context';
import { resolveLocalizedText } from '../../src/lib/localized-text';
import { signInHref } from '../../src/lib/return-path';
import { usePhotographerProfile } from '../../src/lib/use-photographer-profile';

type PublicPhotographerProfile = components['schemas']['PublicPhotographerProfile'];

const AVATAR_SIZE = 88;

function ProfileHeader({ profile }: { profile: PublicPhotographerProfile }) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const languages = profile.languages
    .map((code) => (i18n.exists(`locale.${code}`) ? t(`locale.${code}`) : code))
    .join(', ');
  const bio = resolveLocalizedText(profile.bio, locale);

  return (
    <View className="gap-3 px-4 pt-4">
      <View className="flex-row gap-4">
        {profile.avatarUrl ? (
          <Image
            source={{ uri: profile.avatarUrl }}
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              borderRadius: AVATAR_SIZE / 2,
              backgroundColor: '#f5f5f5',
            }}
            contentFit="cover"
            accessibilityLabel={t('mobile.profile.avatarAlt', {
              displayName: profile.displayName,
            })}
          />
        ) : (
          <View
            className="rounded-full bg-muted"
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            accessibilityElementsHidden
          />
        )}
        <View className="flex-1 justify-center gap-1">
          <Text className="text-2xl font-semibold text-foreground" accessibilityRole="header">
            {profile.displayName}
          </Text>
          {profile.headline ? (
            <Text className="text-base text-muted-foreground">{profile.headline}</Text>
          ) : null}
          <Text className="text-sm text-muted-foreground">{profile.city}</Text>
        </View>
      </View>
      {profile.ratingCount > 0 ? (
        <Text className="text-sm text-foreground">
          {t('mobile.profile.rating', {
            ratingAvg: profile.ratingAvg,
            ratingCount: profile.ratingCount,
          })}
        </Text>
      ) : null}
      {profile.categories.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {PHOTOGRAPHER_CATEGORIES.filter((category) => profile.categories.includes(category)).map(
            (category) => (
              <View key={category} className="rounded-full bg-secondary px-2 py-0.5">
                <Text className="text-xs font-medium text-secondary-foreground">
                  {t(`common.categories.${category}`)}
                </Text>
              </View>
            ),
          )}
        </View>
      ) : null}
      {languages ? (
        <Text className="text-sm text-muted-foreground">
          {t('mobile.profile.languages', { languages })}
        </Text>
      ) : null}
      {bio ? <Text className="text-base text-foreground">{bio}</Text> : null}
    </View>
  );
}

function BackButton() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/');
        }
      }}
      testID="profile-back"
      className="min-h-11 min-w-11 justify-center self-start px-4"
    >
      <Text className="text-base font-medium text-foreground">{t('mobile.profile.back')}</Text>
    </Pressable>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 bg-background pt-12">
      <BackButton />
      {children}
    </View>
  );
}

export default function PhotographerProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { status } = useAuth();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { state, retry } = usePhotographerProfile(slug);

  function handleRequestQuote() {
    if (status !== 'signed-in') {
      router.push(signInHref(`/photographers/${slug}`));
      return;
    }
    router.push({ pathname: '/requests/new', params: { photographer: slug } });
  }

  if (state.status === 'loading') {
    return (
      <Frame>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator testID="profile-loading" />
        </View>
      </Frame>
    );
  }

  if (state.status === 'not-found') {
    return (
      <Frame>
        <View className="flex-1 items-center justify-center gap-4 p-4" testID="profile-not-found">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.profile.notFound.title')}
          </Text>
          <Text className="text-center text-muted-foreground">
            {t('mobile.profile.notFound.description')}
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              router.replace('/');
            }}
            className="min-h-11 justify-center"
          >
            <Text className="text-primary underline">{t('mobile.profile.notFound.backHome')}</Text>
          </Pressable>
        </View>
      </Frame>
    );
  }

  if (state.status === 'error') {
    return (
      <Frame>
        <View className="flex-1 items-center justify-center gap-4 p-4" testID="profile-error">
          <Text className="text-center text-destructive" accessibilityRole="alert">
            {t('mobile.profile.loadFailed')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            testID="profile-retry"
            className="min-h-11 justify-center"
          >
            <Text className="text-base font-medium text-foreground underline">
              {t('mobile.profile.retry')}
            </Text>
          </Pressable>
        </View>
      </Frame>
    );
  }

  const { profile, products } = state;

  return (
    <Frame>
      <ScrollView contentContainerClassName="gap-8 pb-8" testID="profile-screen">
        <ProfileHeader profile={profile} />
        <PortfolioGrid images={profile.portfolio} displayName={profile.displayName} />
        <ProductList products={products} slug={profile.slug} />
        <View className="px-4">
          <PrimaryButton
            testID="profile-request-quote"
            label={t('mobile.profile.requestQuoteCta')}
            onPress={handleRequestQuote}
            disabled={status === 'loading'}
          />
        </View>
      </ScrollView>
    </Frame>
  );
}
