'use client';

import { useEffect, useId, useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 5;

type CitySuggestion = components['schemas']['CitySummary'];

export function CityAutocomplete({
  label,
  name,
  defaultValue,
  countryCode,
  onCitySelect,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
  countryCode?: string | undefined;
  // Needed by callers (the request form's location picker) that want the
  // centroid behind a typed city name, not just the text itself.
  onCitySelect?: (city: CitySuggestion | null) => void;
}) {
  const id = useId();
  const listId = `${id}-cities`;
  const [value, setValue] = useState(defaultValue ?? '');
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);

  useEffect(() => {
    const query = value.trim();
    if (query.length === 0) {
      setSuggestions([]);
      onCitySelect?.(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .GET('/v1/cities', {
          params: {
            query: { q: query, limit: SUGGESTION_LIMIT, ...(countryCode ? { countryCode } : {}) },
          },
        })
        .then(({ data }) => {
          if (cancelled) {
            return;
          }
          const results = data ?? [];
          setSuggestions(results);
          onCitySelect?.(
            results.find((city) => city.name.toLowerCase() === query.toLowerCase()) ?? null,
          );
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
            onCitySelect?.(null);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, countryCode]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        list={listId}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion.slug} value={suggestion.name} />
        ))}
      </datalist>
    </div>
  );
}
