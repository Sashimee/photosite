'use client';

import { useEffect, useId, useState } from 'react';

import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 5;

interface CitySuggestion {
  slug: string;
  name: string;
}

export function CityAutocomplete({
  label,
  name,
  defaultValue,
  countryCode,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
  countryCode?: string | undefined;
}) {
  const id = useId();
  const listId = `${id}-cities`;
  const [value, setValue] = useState(defaultValue ?? '');
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);

  useEffect(() => {
    const query = value.trim();
    if (query.length === 0) {
      setSuggestions([]);
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
          if (!cancelled) {
            setSuggestions(data ?? []);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
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
