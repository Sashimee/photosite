import * as Linking from 'expo-linking';
import * as Location from 'expo-location';

export interface Coordinates {
  lat: number;
  lng: number;
}

export type RequestCurrentPositionResult =
  { granted: true; coordinates: Coordinates } | { granted: false; canAskAgain: boolean };

const COORDINATE_PRECISION_FACTOR = 100;

// ~1 km precision, matching apps/web/src/lib/search-params.ts: enough for a
// "near me" radius search, and coarse enough that the coordinate is never
// worth persisting (docs/COMPLIANCE.md).
export function roundCoordinate(value: number): number {
  return Math.round(value * COORDINATE_PRECISION_FACTOR) / COORDINATE_PRECISION_FACTOR;
}

// Only called from the "near me" tap handler, never on mount: requesting
// location at launch is explicitly out of scope for this feature.
export async function requestCurrentPosition(): Promise<RequestCurrentPositionResult> {
  const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) {
    return { granted: false, canAskAgain };
  }

  const position = await Location.getCurrentPositionAsync();
  return {
    granted: true,
    coordinates: {
      lat: roundCoordinate(position.coords.latitude),
      lng: roundCoordinate(position.coords.longitude),
    },
  };
}

export async function openLocationSettings(): Promise<void> {
  await Linking.openSettings();
}
