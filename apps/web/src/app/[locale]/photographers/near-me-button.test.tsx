import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/en/photographers',
  useSearchParams: () => new URLSearchParams('category=wedding'),
}));

import { NearMeButton } from './near-me-button';

describe('NearMeButton', () => {
  const originalGeolocation = navigator.geolocation;

  afterEach(() => {
    pushMock.mockReset();
    Object.defineProperty(navigator, 'geolocation', {
      value: originalGeolocation,
      configurable: true,
    });
  });

  it('navigates with rounded coordinates, radiusKm and the existing filters, dropping any cursor', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 49.611789, longitude: 6.135999 },
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    const user = userEvent.setup();

    render(<NearMeButton label="Near me" errorMessage="Couldn't locate you" />);
    await user.click(screen.getByRole('button', { name: 'Near me' }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    const [href] = pushMock.mock.calls[0] as [string];
    const [path, query] = href.split('?');
    const params = new URLSearchParams(query);

    expect(path).toBe('/en/photographers');
    expect(params.get('category')).toBe('wedding');
    expect(params.get('lat')).toBe('49.61');
    expect(params.get('lng')).toBe('6.14');
    expect(params.get('radiusKm')).toBe('25');
    expect(params.has('cursor')).toBe(false);
  });

  it('shows an error message and does not navigate when geolocation fails', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    const user = userEvent.setup();

    render(<NearMeButton label="Near me" errorMessage="Couldn't locate you" />);
    await user.click(screen.getByRole('button', { name: 'Near me' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't locate you");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows an error message when geolocation is unsupported', async () => {
    // @ts-expect-error simulating a browser without the Geolocation API
    delete navigator.geolocation;
    const user = userEvent.setup();

    render(<NearMeButton label="Near me" errorMessage="Couldn't locate you" />);
    await user.click(screen.getByRole('button', { name: 'Near me' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't locate you");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
