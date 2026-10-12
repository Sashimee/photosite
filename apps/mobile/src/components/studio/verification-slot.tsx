import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { UPLOAD_PURPOSE_LIMITS, resolveLocale } from '@photoo/shared';

import {
  openAppSettings,
  pickVerificationDocument,
  type PickSource,
} from '../../lib/attachment-pickers';
import type { PickedFile } from '../../lib/chat-attachments';
import { resolveLocalizedText } from '../../lib/localized-text';
import type { VerificationUploadEntry } from '../../lib/use-verification-uploads';

type RequiredDocument = components['schemas']['RequiredDocument'];
type VerificationDocument = components['schemas']['VerificationDocument'];

const MAX_MEGABYTES = Math.round(
  UPLOAD_PURPOSE_LIMITS.verification_document.maxSizeBytes / (1024 * 1024),
);
const NON_RETRYABLE = ['unsupportedType', 'tooLarge', 'infected'];

function SourceButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      className="min-h-11 justify-center rounded-md border border-input px-3"
    >
      <Text className="text-sm font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}

export function VerificationSlot({
  requirement,
  document,
  entry,
  readOnly,
  onPicked,
  onRetry,
  onDismiss,
}: {
  requirement: RequiredDocument;
  document: VerificationDocument | null;
  entry: VerificationUploadEntry | undefined;
  readOnly: boolean;
  onPicked: (file: PickedFile) => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [denied, setDenied] = useState(false);
  const label =
    resolveLocalizedText(requirement.label, resolveLocale(i18n.language)) ?? requirement.key;
  const acceptsImages = requirement.acceptedMimeTypes.some((type) => type.startsWith('image/'));
  const busy = entry !== undefined && entry.failure === undefined;
  const testKey = requirement.key;

  async function handlePick(source: PickSource) {
    setDenied(false);
    const result = await pickVerificationDocument(source);
    if (result.status === 'denied') {
      setDenied(true);
    } else if (result.status === 'picked' && result.files[0]) {
      onPicked(result.files[0]);
    }
  }

  let status: string;
  const failure = entry?.failure;
  if (failure === 'unsupportedType') {
    status = t('mobile.studio.verification.unsupportedType');
  } else if (failure === 'tooLarge') {
    status = t('mobile.studio.verification.tooLarge', { limit: MAX_MEGABYTES });
  } else if (failure) {
    status = t(`mobile.studio.verification.uploadErrors.${failure}`);
  } else if (entry?.stage === 'uploading') {
    status = t('mobile.studio.verification.uploading', { percent: entry.percent });
  } else if (entry) {
    status = t(`mobile.studio.verification.${entry.stage}`);
  } else {
    status = t(
      `mobile.studio.verification.documentStatus.${document?.virusScanStatus ?? 'missing'}`,
    );
  }

  return (
    <View
      className="gap-2 rounded-md border border-border p-4"
      testID={`verification-slot-${testKey}`}
    >
      <Text className="text-base font-semibold text-foreground">{label}</Text>
      {requirement.description ? (
        <Text className="text-sm text-muted-foreground">{requirement.description}</Text>
      ) : null}
      <Text
        className={`text-sm ${failure ? 'text-destructive' : 'text-muted-foreground'}`}
        accessibilityRole={failure ? 'alert' : 'text'}
        testID={`verification-slot-status-${testKey}`}
      >
        {status}
      </Text>

      {failure ? (
        <View className="flex-row gap-4">
          {NON_RETRYABLE.includes(failure) ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              testID={`verification-slot-retry-${testKey}`}
              className="min-h-11 justify-center"
            >
              <Text className="text-sm font-medium text-foreground underline">
                {t('mobile.studio.verification.retryCta')}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            testID={`verification-slot-dismiss-${testKey}`}
            className="min-h-11 justify-center"
          >
            <Text className="text-sm font-medium text-foreground underline">
              {t('mobile.studio.verification.dismissCta')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {denied ? (
        <View className="gap-1" accessibilityRole="alert" testID={`verification-denied-${testKey}`}>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.verification.permissionDenied')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void openAppSettings()}
            className="min-h-11 justify-center"
          >
            <Text className="text-sm font-medium text-foreground underline">
              {t('mobile.studio.verification.openSettings')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {readOnly || busy ? null : (
        <View className="flex-row flex-wrap gap-2">
          {acceptsImages ? (
            <>
              <SourceButton
                testID={`verification-camera-${testKey}`}
                label={t('mobile.studio.verification.cameraCta')}
                onPress={() => void handlePick('camera')}
              />
              <SourceButton
                testID={`verification-library-${testKey}`}
                label={t('mobile.studio.verification.libraryCta')}
                onPress={() => void handlePick('library')}
              />
            </>
          ) : null}
          <SourceButton
            testID={`verification-files-${testKey}`}
            label={t('mobile.studio.verification.filesCta')}
            onPress={() => void handlePick('files')}
          />
        </View>
      )}
    </View>
  );
}
