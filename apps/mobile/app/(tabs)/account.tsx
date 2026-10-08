import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AccountProfile } from '../../src/components/account/account-profile';
import { DataExport } from '../../src/components/account/data-export';
import { DeleteAccount } from '../../src/components/account/delete-account';
import { LanguageSwitcher } from '../../src/components/account/language-switcher';
import { SignOut } from '../../src/components/account/sign-out';
import { useAuth } from '../../src/lib/auth-context';
import { signInHref } from '../../src/lib/return-path';

function ConsentEntry() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push('/consent');
      }}
      testID="account-consent-entry"
      className="mt-3 min-h-11 gap-1 rounded-md border border-border bg-card p-4"
    >
      <Text className="text-base font-semibold text-foreground">
        {t('mobile.consent.settingsEntry')}
      </Text>
      <Text className="text-sm text-muted-foreground">{t('mobile.consent.settingsEntryHint')}</Text>
    </Pressable>
  );
}

function SignedOutContent() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View className="flex-1 bg-background px-6 pt-12">
      <Text className="pb-2 text-2xl font-semibold text-foreground">
        {t('mobile.tabs.account')}
      </Text>
      <Text className="pb-4 text-base text-muted-foreground">
        {t('mobile.account.signedOutIntro')}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          router.push(signInHref('/account'));
        }}
        testID="account-sign-in"
        className="min-h-11 items-center justify-center rounded-md bg-primary p-4"
      >
        <Text className="text-base font-semibold text-primary-foreground">
          {t('mobile.auth.signIn.submit')}
        </Text>
      </Pressable>
      <ConsentEntry />
      <View className="mt-3">
        <LanguageSwitcher />
      </View>
    </View>
  );
}

function AccountContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const isPhotographer = user?.roles.includes('photographer') === true;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-6 pb-12 pt-12">
      <Text className="pb-4 text-2xl font-semibold text-foreground">
        {t('mobile.tabs.account')}
      </Text>
      <AccountProfile />
      {isPhotographer ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('/studio');
          }}
          testID="account-studio-entry"
          className="min-h-11 gap-1 rounded-md border border-border bg-card p-4"
        >
          <Text className="text-base font-semibold text-foreground">
            {t('mobile.studio.accountEntry')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.accountEntryHint')}
          </Text>
        </Pressable>
      ) : null}
      <LanguageSwitcher />
      <ConsentEntry />
      <DataExport />
      <DeleteAccount />
      <SignOut />
    </ScrollView>
  );
}

export default function AccountScreen() {
  const { status } = useAuth();

  if (status === 'loading') {
    return null;
  }
  return status === 'signed-out' ? <SignedOutContent /> : <AccountContent />;
}
