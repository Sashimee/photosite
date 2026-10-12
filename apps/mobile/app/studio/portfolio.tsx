import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { UPLOAD_PURPOSE_LIMITS } from '@photoo/shared';

import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { PortfolioImageCard } from '../../src/components/studio/portfolio-image-card';
import {
  StudioFrame,
  StudioLoading,
  StudioMessage,
} from '../../src/components/studio/studio-frame';
import { openAppSettings, pickPortfolioPhotos } from '../../src/lib/attachment-pickers';
import { requestErrorMessage, scopedStudioTranslate } from '../../src/lib/request-errors';
import { usePortfolio } from '../../src/lib/use-portfolio';
import {
  usePortfolioUploads,
  type PortfolioUploadEntry,
} from '../../src/lib/use-portfolio-uploads';

const PICK_LIMIT = 10;
const MAX_MEGABYTES = Math.round(UPLOAD_PURPOSE_LIMITS.portfolio.maxSizeBytes / (1024 * 1024));
const NON_RETRYABLE = ['unsupportedType', 'tooLarge', 'infected'];

function UploadRow({
  entry,
  onRetry,
  onDismiss,
}: {
  entry: PortfolioUploadEntry;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { failure } = entry;

  let status: string;
  if (failure === 'unsupportedType') {
    status = t('mobile.studio.portfolio.unsupportedType', { name: entry.name });
  } else if (failure === 'tooLarge') {
    status = t('mobile.studio.portfolio.tooLarge', { name: entry.name, limit: MAX_MEGABYTES });
  } else if (failure) {
    status = t(`mobile.studio.portfolio.uploadErrors.${failure}`);
  } else if (entry.stage === 'uploading') {
    status = t('mobile.studio.portfolio.uploading', { percent: entry.percent });
  } else {
    status = t(`mobile.studio.portfolio.${entry.stage}`);
  }

  return (
    <View
      className="gap-1 rounded-md border border-border px-3 py-2"
      testID={`portfolio-upload-${entry.key}`}
    >
      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
        {entry.name}
      </Text>
      <Text
        className={`text-sm ${failure ? 'text-destructive' : 'text-muted-foreground'}`}
        accessibilityRole={failure ? 'alert' : 'text'}
        testID={`portfolio-upload-status-${entry.key}`}
      >
        {status}
      </Text>
      {failure ? (
        <View className="flex-row gap-4">
          {NON_RETRYABLE.includes(failure) ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              testID={`portfolio-upload-retry-${entry.key}`}
              className="min-h-11 justify-center"
            >
              <Text className="text-sm font-medium text-foreground underline">
                {t('mobile.studio.portfolio.retryCta')}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            testID={`portfolio-upload-dismiss-${entry.key}`}
            className="min-h-11 justify-center"
          >
            <Text className="text-sm font-medium text-foreground underline">
              {t('mobile.studio.portfolio.dismissCta')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function PortfolioManager() {
  const { t } = useTranslation();
  const router = useRouter();
  const portfolio = usePortfolio();
  const uploads = usePortfolioUploads(portfolio.append);
  const [denied, setDenied] = useState(false);
  const { state } = portfolio;

  async function handlePick() {
    setDenied(false);
    const result = await pickPortfolioPhotos(PICK_LIMIT);
    if (result.status === 'denied') {
      setDenied(true);
    } else if (result.status === 'picked') {
      uploads.add(result.files);
    }
  }

  if (state.status === 'loading') {
    return <StudioLoading testID="portfolio-loading" />;
  }
  if (state.status === 'unauthorized') {
    return (
      <StudioMessage testID="portfolio-unauthorized" message={t('mobile.studio.sessionExpired')} />
    );
  }
  if (state.status === 'error') {
    return (
      <StudioMessage
        testID="portfolio-load-error"
        message={t('mobile.studio.loadFailed')}
        actionLabel={t('mobile.studio.retry')}
        actionTestID="portfolio-retry"
        onAction={portfolio.reload}
      />
    );
  }
  if (state.status === 'missing') {
    return (
      <StudioMessage
        testID="portfolio-needs-profile"
        tone="info"
        message={`${t('mobile.studio.portfolio.needsProfileTitle')}. ${t('mobile.studio.portfolio.needsProfileDescription')}`}
        actionLabel={t('mobile.studio.portfolio.needsProfileCta')}
        actionTestID="portfolio-create-profile"
        onAction={() => {
          router.push('/studio/profile');
        }}
      />
    );
  }

  const translate = scopedStudioTranslate(t, 'portfolio');

  return (
    <ScrollView contentContainerClassName="gap-4 px-6 pb-12" testID="portfolio-manager">
      <Text className="text-muted-foreground">{t('mobile.studio.portfolio.intro')}</Text>
      <Text className="text-sm text-muted-foreground" testID="portfolio-original-notice">
        {t('mobile.studio.portfolio.originalNotice')}
      </Text>
      <PrimaryButton
        testID="portfolio-upload"
        label={t('mobile.studio.portfolio.uploadCta')}
        onPress={() => void handlePick()}
      />
      {denied ? (
        <View className="gap-1" accessibilityRole="alert" testID="portfolio-library-denied">
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.portfolio.libraryDenied')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void openAppSettings()}
            className="min-h-11 justify-center"
          >
            <Text className="text-sm font-medium text-foreground underline">
              {t('mobile.studio.portfolio.openSettings')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {portfolio.reorderError ? (
        <FormNotice tone="error" testID="portfolio-reorder-error">
          {requestErrorMessage(translate, portfolio.reorderError)}
        </FormNotice>
      ) : null}
      {portfolio.deleteError ? (
        <FormNotice tone="error" testID="portfolio-delete-error">
          {requestErrorMessage(translate, portfolio.deleteError)}
        </FormNotice>
      ) : null}

      {uploads.entries.map((entry) => (
        <UploadRow
          key={entry.key}
          entry={entry}
          onRetry={() => {
            uploads.retry(entry.key);
          }}
          onDismiss={() => {
            uploads.dismiss(entry.key);
          }}
        />
      ))}

      {portfolio.images.length === 0 && uploads.entries.length === 0 ? (
        <Text className="text-center text-muted-foreground" testID="portfolio-empty">
          {t('mobile.studio.portfolio.empty')}
        </Text>
      ) : null}

      {portfolio.images.map((image, index) => (
        <PortfolioImageCard
          key={image.id}
          image={image}
          index={index}
          count={portfolio.images.length}
          reorderDisabled={portfolio.isReordering}
          onMove={(direction) => {
            void portfolio.move(index, direction);
          }}
          onDelete={() => portfolio.remove(image.id)}
        />
      ))}
    </ScrollView>
  );
}

export default function StudioPortfolioScreen() {
  const { t } = useTranslation();

  return (
    <StudioFrame title={t('mobile.studio.portfolio.title')}>
      <PortfolioManager />
    </StudioFrame>
  );
}
