import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../lib/location', () => ({
  requestCurrentPosition: jest.fn(),
  openLocationSettings: jest.fn(),
}));

import { openLocationSettings, requestCurrentPosition } from '../../lib/location';
import { NearMeButton } from './near-me-button';

const mockedRequest = jest.mocked(requestCurrentPosition);
const mockedOpenSettings = jest.mocked(openLocationSettings);

beforeEach(() => {
  jest.resetAllMocks();
});

describe('NearMeButton', () => {
  it('reports the rounded coordinates when permission is granted', async () => {
    mockedRequest.mockResolvedValue({ granted: true, coordinates: { lat: 49.61, lng: 6.13 } });
    const onLocated = jest.fn();

    render(<NearMeButton onLocated={onLocated} />);
    fireEvent.press(screen.getByTestId('near-me-button'));

    await waitFor(() => {
      expect(onLocated).toHaveBeenCalledWith({ lat: 49.61, lng: 6.13 });
    });
    expect(screen.queryByTestId('near-me-denied')).toBeNull();
  });

  it('renders the explain state and offers Settings when permission is denied, without calling onLocated', async () => {
    mockedRequest.mockResolvedValue({ granted: false, canAskAgain: false });
    const onLocated = jest.fn();

    render(<NearMeButton onLocated={onLocated} />);
    fireEvent.press(screen.getByTestId('near-me-button'));

    await waitFor(() => screen.getByTestId('near-me-denied'));
    expect(onLocated).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('near-me-open-settings'));
    expect(mockedOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('never requests a position before the button is pressed', () => {
    mockedRequest.mockResolvedValue({ granted: true, coordinates: { lat: 0, lng: 0 } });

    render(<NearMeButton onLocated={jest.fn()} />);

    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
