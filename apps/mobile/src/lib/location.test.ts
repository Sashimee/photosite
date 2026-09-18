import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
}));

jest.mock('expo-linking', () => ({
  openSettings: jest.fn(),
}));

import * as Linking from 'expo-linking';
import * as Location from 'expo-location';

import { openLocationSettings, requestCurrentPosition, roundCoordinate } from './location';

const mockedRequestPermissions = jest.mocked(Location.requestForegroundPermissionsAsync);
const mockedGetCurrentPosition = jest.mocked(Location.getCurrentPositionAsync);
const mockedOpenSettings = jest.mocked(Linking.openSettings);

beforeEach(() => {
  jest.resetAllMocks();
});

describe('roundCoordinate', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundCoordinate(49.611234)).toBe(49.61);
    expect(roundCoordinate(6.135678)).toBe(6.14);
  });
});

describe('requestCurrentPosition', () => {
  it('returns rounded coordinates when permission is granted', async () => {
    mockedRequestPermissions.mockResolvedValue({
      status: Location.PermissionStatus.GRANTED,
      granted: true,
      canAskAgain: true,
      expires: 'never',
    });
    mockedGetCurrentPosition.mockResolvedValue({
      coords: {
        latitude: 49.611234,
        longitude: 6.135678,
        altitude: null,
        accuracy: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: 0,
    });

    const result = await requestCurrentPosition();

    expect(result).toEqual({ granted: true, coordinates: { lat: 49.61, lng: 6.14 } });
  });

  it('returns denied with canAskAgain and issues no position request when permission is refused', async () => {
    mockedRequestPermissions.mockResolvedValue({
      status: Location.PermissionStatus.DENIED,
      granted: false,
      canAskAgain: false,
      expires: 'never',
    });

    const result = await requestCurrentPosition();

    expect(result).toEqual({ granted: false, canAskAgain: false });
    expect(mockedGetCurrentPosition).not.toHaveBeenCalled();
  });
});

describe('openLocationSettings', () => {
  it('delegates to expo-linking', async () => {
    await openLocationSettings();
    expect(mockedOpenSettings).toHaveBeenCalledTimes(1);
  });
});
