import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';

import { CityAutocomplete } from '../../src/components/discovery/city-autocomplete';
import { FilterSheet, type FilterSheetValues } from '../../src/components/discovery/filter-sheet';
import { NearMeButton } from '../../src/components/discovery/near-me-button';
import { PhotographerCard } from '../../src/components/discovery/photographer-card';
import type { Coordinates } from '../../src/lib/location';
import {
  hasActiveFilters,
  parseSearchFilters,
  serializeSearchFilters,
  type SearchFilters,
} from '../../src/lib/search-params';
import { usePhotographerSearch } from '../../src/lib/use-photographer-search';

type CitySummary = components['schemas']['CitySummary'];

const NEAR_ME_RADIUS_KM = 25;
const LOCATION_FILTER_KEYS = ['city', 'countryCode', 'lat', 'lng', 'radiusKm'] as const;

function withoutLocation(filters: SearchFilters): SearchFilters {
  const rest: SearchFilters = { ...filters };
  for (const key of LOCATION_FILTER_KEYS) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- key comes from the fixed LOCATION_FILTER_KEYS list, not user input
    delete rest[key];
  }
  return rest;
}

function toRouteParams(filters: SearchFilters): Record<string, string> {
  return Object.fromEntries(serializeSearchFilters(filters).entries());
}

export default function DiscoverScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const rawParams = useLocalSearchParams();
  const filters = parseSearchFilters(rawParams);
  const { items, status, loadMore, retry } = usePhotographerSearch(filters);

  const [cityText, setCityText] = useState(filters.city ?? '');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  useEffect(() => {
    setCityText(filters.city ?? '');
  }, [filters.city]);

  function navigateToFilters(next: SearchFilters) {
    router.push({ pathname: '/', params: toRouteParams(next) });
  }

  function handleSelectCity(city: CitySummary) {
    setCityText(city.name);
    navigateToFilters({
      ...withoutLocation(filters),
      city: city.name,
      countryCode: city.countryCode,
    });
  }

  function handleLocated(coordinates: Coordinates) {
    navigateToFilters({ ...withoutLocation(filters), ...coordinates, radiusKm: NEAR_ME_RADIUS_KM });
  }

  function handleApplyFilters(values: FilterSheetValues) {
    setFilterSheetVisible(false);
    const next: SearchFilters = { ...filters };
    if (values.category !== undefined) {
      next.category = values.category;
    } else {
      delete next.category;
    }
    if (values.language !== undefined) {
      next.language = values.language;
    } else {
      delete next.language;
    }
    if (values.priceMinCents !== undefined) {
      next.priceMinCents = values.priceMinCents;
    } else {
      delete next.priceMinCents;
    }
    if (values.priceMaxCents !== undefined) {
      next.priceMaxCents = values.priceMaxCents;
    } else {
      delete next.priceMaxCents;
    }
    navigateToFilters(next);
  }

  function handleClearFilters() {
    setFilterSheetVisible(false);
    router.push({ pathname: '/', params: {} });
  }

  const activeFilters = hasActiveFilters(filters);
  const isInitialLoading = status === 'loading';
  const isEmpty = !isInitialLoading && status !== 'error' && items.length === 0;

  return (
    <View className="flex-1 bg-background">
      <FlatList
        testID="discover-results"
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PhotographerCard photographer={item} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          loadMore();
        }}
        contentContainerClassName="pb-8"
        ListHeaderComponent={
          <View className="gap-3 border-b border-border p-4">
            <Text className="text-2xl font-semibold text-foreground">
              {t('mobile.discovery.title')}
            </Text>
            <CityAutocomplete
              value={cityText}
              onChangeText={setCityText}
              onSelectCity={handleSelectCity}
            />
            <View className="flex-row flex-wrap items-center gap-3">
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setFilterSheetVisible(true);
                }}
                testID="open-filter-sheet"
                className="min-h-11 items-center justify-center rounded-md border border-input px-4 py-3"
              >
                <Text className="text-sm font-medium text-foreground">
                  {t('mobile.discovery.filtersButton')}
                </Text>
              </Pressable>
              <NearMeButton onLocated={handleLocated} />
              {activeFilters ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleClearFilters}
                  testID="clear-filters"
                  className="min-h-11 items-center justify-center px-2"
                >
                  <Text className="text-sm font-medium text-foreground underline">
                    {t('mobile.discovery.clearFilters')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          isInitialLoading ? (
            <View className="items-center py-16" testID="discover-loading">
              <ActivityIndicator />
            </View>
          ) : status === 'error' ? (
            <View className="items-center gap-3 py-16" testID="discover-error">
              <Text className="text-muted-foreground">{t('common.error')}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                testID="discover-retry"
                className="min-h-11 items-center justify-center rounded-md border border-input px-4 py-3"
              >
                <Text className="text-sm font-medium text-foreground">{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : isEmpty ? (
            <View className="items-center gap-3 py-16" testID="discover-empty">
              <Text className="text-muted-foreground">
                {activeFilters ? t('mobile.discovery.empty') : t('mobile.discovery.emptyNoFilters')}
              </Text>
              {activeFilters ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleClearFilters}
                  testID="discover-empty-clear-filters"
                  className="min-h-11 items-center justify-center"
                >
                  <Text className="text-sm font-medium text-foreground underline">
                    {t('mobile.discovery.clearFilters')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
        ListFooterComponent={
          status === 'loadingMore' ? (
            <View className="items-center py-4" testID="discover-loading-more">
              <ActivityIndicator />
            </View>
          ) : null
        }
      />
      <FilterSheet
        visible={filterSheetVisible}
        initialValues={{
          category: filters.category,
          language: filters.language,
          priceMinCents: filters.priceMinCents,
          priceMaxCents: filters.priceMaxCents,
        }}
        onClose={() => {
          setFilterSheetVisible(false);
        }}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
      />
    </View>
  );
}
