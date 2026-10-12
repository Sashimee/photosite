import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';

import type { components } from '@photoo/api-client';

import { PhotoViewer } from './photo-viewer';

type PublicPortfolioImage = components['schemas']['PublicPortfolioImage'];

const COLUMNS = 3;
const GAP = 4;
const PADDING = 16;

export function PortfolioGrid({
  images,
  displayName,
}: {
  images: readonly PublicPortfolioImage[];
  displayName: string;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const sorted = useMemo(() => [...images].sort((a, b) => a.order - b.order), [images]);

  if (sorted.length === 0) {
    return null;
  }

  const cell = (width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <View className="gap-3 px-4" testID="portfolio-grid">
      <Text className="text-xl font-semibold text-foreground" accessibilityRole="header">
        {t('mobile.profile.portfolioHeading')}
      </Text>
      <View className="flex-row flex-wrap" style={{ gap: GAP }}>
        {sorted.map((image, index) => (
          <Pressable
            key={image.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('mobile.profile.portfolioImageAlt', {
              displayName,
              index: index + 1,
            })}
            onPress={() => {
              setViewerIndex(index);
            }}
            testID={`portfolio-image-${image.id}`}
          >
            <Image
              source={{ uri: image.url }}
              style={{ width: cell, height: cell, backgroundColor: '#f5f5f5' }}
              contentFit="cover"
            />
          </Pressable>
        ))}
      </View>
      {viewerIndex === null ? null : (
        <PhotoViewer
          images={sorted}
          displayName={displayName}
          initialIndex={viewerIndex}
          onClose={() => {
            setViewerIndex(null);
          }}
        />
      )}
    </View>
  );
}
