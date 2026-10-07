import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { components } from '@photoo/api-client';

type PublicPortfolioImage = components['schemas']['PublicPortfolioImage'];

export function PhotoViewer({
  images,
  displayName,
  initialIndex,
  onClose,
}: {
  images: readonly PublicPortfolioImage[];
  displayName: string;
  initialIndex: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<PublicPortfolioImage>>(null);
  const [index, setIndex] = useState(initialIndex);

  function goTo(next: number) {
    if (next < 0 || next >= images.length) {
      return;
    }
    setIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  }

  function handleMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} testID="photo-viewer">
      <View className="flex-1 bg-black">
        <FlatList
          ref={listRef}
          testID="photo-viewer-list"
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, itemIndex) => ({
            length: width,
            offset: width * itemIndex,
            index: itemIndex,
          })}
          onMomentumScrollEnd={handleMomentumEnd}
          renderItem={({ item, index: itemIndex }) => (
            <Image
              source={{ uri: item.url }}
              style={{ width, height: '100%' }}
              contentFit="contain"
              accessibilityLabel={t('mobile.profile.portfolioImageAlt', {
                displayName,
                index: itemIndex + 1,
              })}
            />
          )}
        />
        <View className="absolute inset-x-0 top-12 flex-row items-center justify-between px-4">
          <Text className="text-base font-medium text-white" testID="photo-viewer-position">
            {t('mobile.profile.viewer.position', { index: index + 1, total: images.length })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.profile.viewer.close')}
            onPress={onClose}
            testID="photo-viewer-close"
            className="min-h-11 min-w-11 items-center justify-center"
          >
            <Text className="text-base font-medium text-white">
              {t('mobile.profile.viewer.close')}
            </Text>
          </Pressable>
        </View>
        <View className="absolute inset-x-0 bottom-10 flex-row justify-between px-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.profile.viewer.previous')}
            accessibilityState={{ disabled: index === 0 }}
            disabled={index === 0}
            onPress={() => {
              goTo(index - 1);
            }}
            testID="photo-viewer-previous"
            className={`min-h-11 min-w-11 items-center justify-center ${index === 0 ? 'opacity-40' : ''}`}
          >
            <Text className="text-2xl text-white">{'‹'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.profile.viewer.next')}
            accessibilityState={{ disabled: index === images.length - 1 }}
            disabled={index === images.length - 1}
            onPress={() => {
              goTo(index + 1);
            }}
            testID="photo-viewer-next"
            className={`min-h-11 min-w-11 items-center justify-center ${index === images.length - 1 ? 'opacity-40' : ''}`}
          >
            <Text className="text-2xl text-white">{'›'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
