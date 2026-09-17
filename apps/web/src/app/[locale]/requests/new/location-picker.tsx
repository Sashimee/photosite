'use client';

import { useState } from 'react';

import type { components } from '@photoo/api-client';

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-message';
import { roundCoordinate } from '@/lib/search-params';

import { CityAutocomplete } from '../../photographers/city-autocomplete';

type CitySummary = components['schemas']['CitySummary'];

export interface PickedLocation {
  lat: number;
  lng: number;
}

export function LocationPicker({
  location,
  onLocationChange,
  onCityPicked,
  cityLabel,
  useMyLocationLabel,
  useMyLocationErrorLabel,
  locationSetLabel,
  requiredError,
}: {
  location: PickedLocation | null;
  onLocationChange: (location: PickedLocation | null) => void;
  onCityPicked: (city: { name: string; countryCode: string }) => void;
  cityLabel: string;
  useMyLocationLabel: string;
  useMyLocationErrorLabel: string;
  locationSetLabel: string;
  requiredError?: string | undefined;
}) {
  const [geoStatus, setGeoStatus] = useState<'idle' | 'locating' | 'error'>('idle');
  // Tracks which source last set `location`: retyping or clearing the city
  // field should only clear a location that same field set, not one from
  // "use my location".
  const [source, setSource] = useState<'city' | 'geo' | null>(null);

  function handleCitySelect(city: CitySummary | null) {
    if (!city) {
      if (source === 'city') {
        setSource(null);
        onLocationChange(null);
      }
      return;
    }
    setSource('city');
    onLocationChange(city.location);
    onCityPicked({ name: city.name, countryCode: city.countryCode });
  }

  function handleUseMyLocation() {
    if (!('geolocation' in navigator)) {
      setGeoStatus('error');
      return;
    }
    setGeoStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoStatus('idle');
        setSource('geo');
        onLocationChange({
          lat: roundCoordinate(position.coords.latitude),
          lng: roundCoordinate(position.coords.longitude),
        });
      },
      () => {
        setGeoStatus('error');
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <CityAutocomplete label={cityLabel} name="location-city" onCitySelect={handleCitySelect} />
      <Button
        type="button"
        variant="outline"
        disabled={geoStatus === 'locating'}
        onClick={handleUseMyLocation}
        className="self-start"
      >
        {useMyLocationLabel}
      </Button>
      {geoStatus === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {useMyLocationErrorLabel}
        </p>
      ) : null}
      {location ? (
        <p role="status" className="text-sm text-muted-foreground">
          {locationSetLabel}
        </p>
      ) : null}
      <FieldError id="location-required-error" message={requiredError} />
    </div>
  );
}
