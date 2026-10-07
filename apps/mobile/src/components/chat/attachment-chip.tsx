import { Image } from 'expo-image';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';

import { api } from '../../lib/api';

type MessageAttachment = components['schemas']['MessageAttachment'];

export function formatBytes(t: TFunction, sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) {
    return t('mobile.chat.attachments.sizeKb', {
      size: String(Math.max(1, Math.round(sizeBytes / 1024))),
    });
  }
  return t('mobile.chat.attachments.sizeMb', { size: (sizeBytes / (1024 * 1024)).toFixed(1) });
}

function isOpenableUrl(url: string): boolean {
  return url.startsWith('https://') || (__DEV__ && url.startsWith('http://'));
}

export function AttachmentChip({
  attachment,
  conversationId,
  messageId,
}: {
  attachment: MessageAttachment;
  conversationId: string;
  messageId: string;
}) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const isImage = attachment.kind === 'image';

  async function open() {
    if (opening) {
      return;
    }
    setOpening(true);
    setFailed(false);
    try {
      const { data } = await api.GET(
        '/v1/conversations/{id}/messages/{messageId}/attachments/{attachmentId}/download',
        { params: { path: { id: conversationId, messageId, attachmentId: attachment.id } } },
      );
      if (!data || !isOpenableUrl(data.url)) {
        setFailed(true);
      } else if (isImage) {
        setImageUrl(data.url);
      } else {
        await Linking.openURL(data.url);
      }
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return (
    <View className="items-start gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isImage ? t('mobile.chat.attachments.viewCta') : t('mobile.chat.attachments.downloadCta')
        }
        accessibilityState={{ busy: opening }}
        onPress={() => void open()}
        testID={`attachment-${attachment.id}`}
        className="min-h-11 flex-row items-center gap-2 rounded-md border border-border px-3"
      >
        <Text className="text-xs font-medium uppercase text-foreground">
          {isImage ? t('mobile.chat.attachments.kindImage') : t('mobile.chat.attachments.kindPdf')}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {opening ? t('mobile.chat.attachments.opening') : formatBytes(t, attachment.sizeBytes)}
        </Text>
      </Pressable>
      {failed ? (
        <Text className="text-xs text-destructive" accessibilityRole="alert">
          {t('mobile.chat.attachments.openFailed')}
        </Text>
      ) : null}
      {imageUrl ? (
        <Modal
          visible
          animationType="fade"
          onRequestClose={() => {
            setImageUrl(null);
          }}
        >
          <View className="flex-1 bg-black">
            <Image
              source={{ uri: imageUrl }}
              style={{ flex: 1 }}
              contentFit="contain"
              cachePolicy="memory"
              accessibilityLabel={t('mobile.chat.attachments.imageAlt')}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setImageUrl(null);
              }}
              testID={`attachment-close-${attachment.id}`}
              className="absolute right-4 top-12 min-h-11 min-w-11 items-center justify-center"
            >
              <Text className="text-base font-medium text-white">
                {t('mobile.chat.attachments.closeCta')}
              </Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
