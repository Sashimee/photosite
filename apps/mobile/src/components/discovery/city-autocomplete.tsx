import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';

import { api } from '../../lib/api';
import { TextField } from '../form/text-field';

type CitySummary = components['schemas']['CitySummary'];

const DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 5;

export function CityAutocomplete({
  value,
  onChangeText,
  onSelectCity,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSelectCity: (city: CitySummary) => void;
}) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<CitySummary[]>([]);

  useEffect(() => {
    const query = value.trim();
    if (query.length === 0) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .GET('/v1/cities', {
          params: { query: { q: query, limit: SUGGESTION_LIMIT } },
          signal: controller.signal,
        })
        .then(({ data }) => {
          if (data) {
            setSuggestions(data);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSuggestions([]);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  return (
    <View className="gap-2" testID="city-autocomplete">
      <TextField
        testID="city-autocomplete-input"
        label={t('mobile.discovery.searchLabel')}
        placeholder={t('mobile.discovery.searchPlaceholder')}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="words"
        autoComplete="off"
        autoCorrect={false}
      />
      {suggestions.length > 0 ? (
        <View
          className="overflow-hidden rounded-md border border-border bg-card"
          testID="city-autocomplete-suggestions"
          accessibilityRole="list"
        >
          {suggestions.map((city) => (
            <Pressable
              key={city.slug}
              accessibilityRole="button"
              accessibilityLabel={city.name}
              onPress={() => {
                onSelectCity(city);
              }}
              className="min-h-11 justify-center border-b border-border px-3 py-2"
              testID={`city-suggestion-${city.slug}`}
            >
              <Text className="text-base text-foreground">{city.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
