import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';

import { ConfirmAction } from '../requests/confirm-action';
import { StatusBadge } from '../requests/status-badge';

type PortfolioImage = components['schemas']['PortfolioImage'];

const THUMBNAIL_SIZE = 96;

function MoveButton({
  label,
  glyph,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      className={`min-h-11 min-w-11 items-center justify-center rounded-md border border-input ${disabled ? 'opacity-40' : ''}`}
    >
      <Text className="text-base text-foreground">{glyph}</Text>
    </Pressable>
  );
}

export function PortfolioImageCard({
  image,
  index,
  count,
  reorderDisabled,
  onMove,
  onDelete,
}: {
  image: PortfolioImage;
  index: number;
  count: number;
  reorderDisabled: boolean;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const position = index + 1;
  const [deleting, setDeleting] = useState(false);

  return (
    <View
      className="gap-3 rounded-md border border-border bg-card p-3"
      testID={`portfolio-image-${image.id}`}
    >
      <View className="flex-row gap-3">
        {image.url ? (
          <Image
            source={{ uri: image.url }}
            style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, backgroundColor: '#f5f5f5' }}
            contentFit="cover"
            accessibilityLabel={t('mobile.studio.portfolio.imageAlt', { index: position })}
          />
        ) : (
          <View
            className="items-center justify-center bg-muted"
            style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
            testID={`portfolio-image-${image.id}-processing`}
          >
            <Text className="text-center text-xs text-muted-foreground">
              {t('mobile.studio.portfolio.processing')}
            </Text>
          </View>
        )}
        <View className="flex-1 justify-between">
          <StatusBadge
            testID={`portfolio-status-${image.id}`}
            label={t(`mobile.studio.portfolio.status.${image.status}`)}
            muted={image.status !== 'approved'}
          />
          <View className="flex-row gap-2">
            <MoveButton
              testID={`portfolio-up-${image.id}`}
              label={t('mobile.studio.portfolio.moveUpCta', { index: position })}
              glyph="↑"
              disabled={reorderDisabled || index === 0}
              onPress={() => {
                onMove(-1);
              }}
            />
            <MoveButton
              testID={`portfolio-down-${image.id}`}
              label={t('mobile.studio.portfolio.moveDownCta', { index: position })}
              glyph="↓"
              disabled={reorderDisabled || index === count - 1}
              onPress={() => {
                onMove(1);
              }}
            />
          </View>
        </View>
      </View>
      <ConfirmAction
        outline
        testID={`portfolio-delete-${image.id}`}
        triggerLabel={t('mobile.studio.portfolio.deleteCta')}
        title={t('mobile.studio.portfolio.deleteConfirmTitle')}
        description={t('mobile.studio.portfolio.deleteConfirmDescription')}
        confirmLabel={t('mobile.studio.portfolio.deleteConfirmCta')}
        pendingLabel={t('mobile.studio.portfolio.deletePending')}
        dismissLabel={t('mobile.studio.portfolio.deleteDismissCta')}
        pending={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await onDelete();
          } finally {
            setDeleting(false);
          }
        }}
      />
    </View>
  );
}
