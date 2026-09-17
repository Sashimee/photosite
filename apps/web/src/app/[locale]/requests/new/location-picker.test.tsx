import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiGetMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));

async function loadLocationPicker() {
  const { LocationPicker } = await import('./location-picker');
  return LocationPicker;
}

const labels = {
  cityLabel: 'City',
  useMyLocationLabel: 'Use my location',
  useMyLocationErrorLabel: "Couldn't locate you",
  locationSetLabel: 'Location set.',
};

describe('LocationPicker', () => {
  const originalGeolocation = navigator.geolocation;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    apiGetMock.mockReset();
    Object.defineProperty(navigator, 'geolocation', {
      value: originalGeolocation,
      configurable: true,
    });
  });

  it('sets the location and fires onCityPicked when a suggested city matches', async () => {
    apiGetMock.mockResolvedValue({
      data: [
        {
          slug: 'luxembourg-city',
          name: 'Luxembourg City',
          countryCode: 'LU',
          photographerCount: 3,
          location: { lat: 49.61, lng: 6.13 },
        },
      ],
    });
    const onLocationChange = vi.fn();
    const onCityPicked = vi.fn();
    const LocationPicker = await loadLocationPicker();

    render(
      <LocationPicker
        location={null}
        onLocationChange={onLocationChange}
        onCityPicked={onCityPicked}
        {...labels}
      />,
    );

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Luxembourg City' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(onLocationChange).toHaveBeenCalledWith({ lat: 49.61, lng: 6.13 });
    expect(onCityPicked).toHaveBeenCalledWith({ name: 'Luxembourg City', countryCode: 'LU' });
  });

  it('rounds a geolocation result to 2 decimals and sets the location', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 49.611789, longitude: 6.135999 },
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    vi.useRealTimers();
    const onLocationChange = vi.fn();
    const LocationPicker = await loadLocationPicker();
    const user = userEvent.setup();

    render(
      <LocationPicker
        location={null}
        onLocationChange={onLocationChange}
        onCityPicked={vi.fn()}
        {...labels}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Use my location' }));

    expect(onLocationChange).toHaveBeenCalledWith({ lat: 49.61, lng: 6.14 });
  });

  it('clears a city-sourced location when the city is cleared', async () => {
    apiGetMock.mockResolvedValue({
      data: [
        {
          slug: 'luxembourg-city',
          name: 'Luxembourg City',
          countryCode: 'LU',
          photographerCount: 3,
          location: { lat: 49.61, lng: 6.13 },
        },
      ],
    });
    const onLocationChange = vi.fn();
    const LocationPicker = await loadLocationPicker();
    render(
      <LocationPicker
        location={null}
        onLocationChange={onLocationChange}
        onCityPicked={vi.fn()}
        {...labels}
      />,
    );
    const input = screen.getByLabelText('City');

    fireEvent.change(input, { target: { value: 'Luxembourg City' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    onLocationChange.mockClear();

    fireEvent.change(input, { target: { value: 'Luxembourg Cit' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(onLocationChange).toHaveBeenLastCalledWith(null);
  });

  it('does not clear a geolocation-sourced location when the city field changes', async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 49.611789, longitude: 6.135999 } } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    const onLocationChange = vi.fn();
    const LocationPicker = await loadLocationPicker();
    render(
      <LocationPicker
        location={null}
        onLocationChange={onLocationChange}
        onCityPicked={vi.fn()}
        {...labels}
      />,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Use my location' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onLocationChange).toHaveBeenLastCalledWith({ lat: 49.61, lng: 6.14 });
    onLocationChange.mockClear();

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Somewhere else' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(onLocationChange).not.toHaveBeenCalled();
  });

  it('shows an error when geolocation is unsupported', async () => {
    // @ts-expect-error simulating a browser without the Geolocation API
    delete navigator.geolocation;
    vi.useRealTimers();
    const LocationPicker = await loadLocationPicker();
    const user = userEvent.setup();

    render(
      <LocationPicker
        location={null}
        onLocationChange={vi.fn()}
        onCityPicked={vi.fn()}
        {...labels}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Use my location' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't locate you");
  });

  it('shows the required error message when given one', async () => {
    const LocationPicker = await loadLocationPicker();
    render(
      <LocationPicker
        location={null}
        onLocationChange={vi.fn()}
        onCityPicked={vi.fn()}
        requiredError="Choose a city or use your location before sending the request."
        {...labels}
      />,
    );

    expect(
      screen.getByText('Choose a city or use your location before sending the request.'),
    ).toBeInTheDocument();
  });

  it('shows the confirmation message once a location is set', async () => {
    const LocationPicker = await loadLocationPicker();
    render(
      <LocationPicker
        location={{ lat: 49.61, lng: 6.13 }}
        onLocationChange={vi.fn()}
        onCityPicked={vi.fn()}
        {...labels}
      />,
    );

    expect(screen.getByText('Location set.')).toBeInTheDocument();
  });
});
