import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import {
  PHOTOGRAPHER_CATEGORIES,
  SUPPORTED_LOCALES,
  type PhotographerCategory,
} from '@photoo/shared';

import { FormNotice } from '../form/form-notice';
import { PrimaryButton } from '../form/primary-button';
import { TextField } from '../form/text-field';

const CENTS_PER_UNIT = 100;

function centsToUnitsText(cents: number | undefined): string {
  return cents === undefined ? '' : String(cents / CENTS_PER_UNIT);
}

function unitsTextToCents(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const units = Number(trimmed);
  if (!Number.isFinite(units) || units < 0) {
    return undefined;
  }
  return Math.round(units * CENTS_PER_UNIT);
}

export interface FilterSheetValues {
  category?: PhotographerCategory | undefined;
  language?: string | undefined;
  priceMinCents?: number | undefined;
  priceMaxCents?: number | undefined;
}

export function FilterSheet({
  visible,
  initialValues,
  onClose,
  onApply,
  onClear,
}: {
  visible: boolean;
  initialValues: FilterSheetValues;
  onClose: () => void;
  onApply: (values: FilterSheetValues) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<PhotographerCategory | undefined>(
    initialValues.category,
  );
  const [language, setLanguage] = useState<string | undefined>(initialValues.language);
  const [priceMinText, setPriceMinText] = useState(centsToUnitsText(initialValues.priceMinCents));
  const [priceMaxText, setPriceMaxText] = useState(centsToUnitsText(initialValues.priceMaxCents));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setCategory(initialValues.category);
    setLanguage(initialValues.language);
    setPriceMinText(centsToUnitsText(initialValues.priceMinCents));
    setPriceMaxText(centsToUnitsText(initialValues.priceMaxCents));
    setError(null);
  }, [visible, initialValues]);

  function handleApply() {
    const priceMinCents = unitsTextToCents(priceMinText);
    const priceMaxCents = unitsTextToCents(priceMaxText);
    if (
      priceMinCents !== undefined &&
      priceMaxCents !== undefined &&
      priceMinCents > priceMaxCents
    ) {
      setError(t('mobile.discovery.filters.priceRangeInvalid'));
      return;
    }
    setError(null);
    onApply({ category, language, priceMinCents, priceMaxCents });
  }

  function handleClear() {
    setCategory(undefined);
    setLanguage(undefined);
    setPriceMinText('');
    setPriceMaxText('');
    setError(null);
    onClear();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-4 p-6"
        accessibilityViewIsModal
      >
        <View className="flex-row items-center justify-between">
          <Text accessibilityRole="header" className="text-xl font-semibold text-foreground">
            {t('mobile.discovery.filters.title')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            testID="filter-sheet-close"
            className="min-h-11 min-w-11 items-center justify-center"
          >
            <Text className="text-base text-foreground">{'✕'}</Text>
          </Pressable>
        </View>

        {error ? (
          <FormNotice tone="error" testID="filter-sheet-error">
            {error}
          </FormNotice>
        ) : null}

        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            {t('mobile.discovery.filters.categoryLabel')}
          </Text>
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            <Chip
              label={t('mobile.discovery.filters.allCategories')}
              selected={category === undefined}
              onPress={() => {
                setCategory(undefined);
              }}
              testID="category-chip-all"
            />
            {PHOTOGRAPHER_CATEGORIES.map((value) => (
              <Chip
                key={value}
                label={t(`common.categories.${value}`)}
                selected={category === value}
                onPress={() => {
                  setCategory(value);
                }}
                testID={`category-chip-${value}`}
              />
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            {t('mobile.discovery.filters.languageLabel')}
          </Text>
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            <Chip
              label={t('mobile.discovery.filters.allLanguages')}
              selected={language === undefined}
              onPress={() => {
                setLanguage(undefined);
              }}
              testID="language-chip-all"
            />
            {SUPPORTED_LOCALES.map((code) => (
              <Chip
                key={code}
                label={t(`locale.${code}`)}
                selected={language === code}
                onPress={() => {
                  setLanguage(code);
                }}
                testID={`language-chip-${code}`}
              />
            ))}
          </View>
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <TextField
              testID="filter-price-min"
              label={t('mobile.discovery.filters.priceMinLabel')}
              value={priceMinText}
              onChangeText={setPriceMinText}
              keyboardType="numeric"
              inputMode="numeric"
            />
          </View>
          <View className="flex-1">
            <TextField
              testID="filter-price-max"
              label={t('mobile.discovery.filters.priceMaxLabel')}
              value={priceMaxText}
              onChangeText={setPriceMaxText}
              keyboardType="numeric"
              inputMode="numeric"
            />
          </View>
        </View>

        <PrimaryButton
          testID="filter-sheet-apply"
          label={t('mobile.discovery.filters.apply')}
          onPress={handleApply}
        />
        <Pressable
          accessibilityRole="button"
          onPress={handleClear}
          testID="filter-sheet-clear"
          className="min-h-11 items-center justify-center"
        >
          <Text className="text-sm font-medium text-foreground underline">
            {t('mobile.discovery.filters.clear')}
          </Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      testID={testID}
      className={`min-h-11 justify-center rounded-full border px-3 py-2 ${
        selected ? 'border-primary bg-primary' : 'border-input bg-background'
      }`}
    >
      <Text
        className={`text-sm font-medium ${selected ? 'text-primary-foreground' : 'text-foreground'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
