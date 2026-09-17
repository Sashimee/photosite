import { Link, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen options={{ title: t('mobile.notFound.title') }} />
      <View className="flex-1 items-center justify-center gap-4 bg-background p-4">
        <Text className="text-lg font-semibold text-foreground">{t('mobile.notFound.title')}</Text>
        <Text className="text-center text-muted-foreground">
          {t('mobile.notFound.description')}
        </Text>
        <Link href="/" className="text-primary underline">
          {t('mobile.notFound.backHome')}
        </Link>
      </View>
    </>
  );
}
