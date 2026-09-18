import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../lib/api', () => ({
  api: { GET: jest.fn() },
}));

import { api } from '../../lib/api';
import { CityAutocomplete } from './city-autocomplete';

const mockedGet = jest.mocked(api.GET);

beforeEach(() => {
  jest.resetAllMocks();
});

const luxembourg = {
  slug: 'luxembourg',
  name: 'Luxembourg',
  countryCode: 'LU',
  photographerCount: 12,
  location: { lat: 49.61, lng: 6.13 },
};

const metz = {
  slug: 'metz',
  name: 'Metz',
  countryCode: 'FR',
  photographerCount: 4,
  location: { lat: 49.12, lng: 6.18 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CityAutocomplete', () => {
  it('debounces the request and only queries once for rapid keystrokes', async () => {
    jest.useFakeTimers();
    mockedGet.mockResolvedValue({
      data: [luxembourg],
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    const { rerender } = render(
      <CityAutocomplete value="L" onChangeText={jest.fn()} onSelectCity={jest.fn()} />,
    );
    rerender(<CityAutocomplete value="Lu" onChangeText={jest.fn()} onSelectCity={jest.fn()} />);
    rerender(<CityAutocomplete value="Lux" onChangeText={jest.fn()} onSelectCity={jest.fn()} />);

    jest.advanceTimersByTime(250);
    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledTimes(1);
    });
    expect(mockedGet).toHaveBeenCalledWith(
      '/v1/cities',
      expect.objectContaining({ params: { query: { q: 'Lux', limit: 5 } } }),
    );

    jest.useRealTimers();
  });

  it('keeps the last successful suggestions visible while the next request is loading', async () => {
    jest.useFakeTimers();
    const first = deferred<{ data: (typeof luxembourg)[]; error: undefined; response: Response }>();
    const second = deferred<{ data: (typeof metz)[]; error: undefined; response: Response }>();
    mockedGet.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(
      <CityAutocomplete value="Lux" onChangeText={jest.fn()} onSelectCity={jest.fn()} />,
    );
    jest.advanceTimersByTime(250);
    first.resolve({ data: [luxembourg], error: undefined, response: new Response(null) });
    await waitFor(() => screen.getByTestId('city-suggestion-luxembourg'));

    rerender(<CityAutocomplete value="Met" onChangeText={jest.fn()} onSelectCity={jest.fn()} />);
    jest.advanceTimersByTime(250);

    expect(screen.getByTestId('city-suggestion-luxembourg')).toBeTruthy();

    second.resolve({ data: [metz], error: undefined, response: new Response(null) });
    await waitFor(() => screen.getByTestId('city-suggestion-metz'));
    expect(screen.queryByTestId('city-suggestion-luxembourg')).toBeNull();

    jest.useRealTimers();
  });

  it('cancels the in-flight request when the value changes before it resolves', async () => {
    jest.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const pendingImplementation = (..._args: unknown[]) => {
      capturedSignal = (_args[1] as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise(() => {
        // Intentionally never resolves: this call is superseded before it can.
      });
    };
    mockedGet.mockImplementationOnce(pendingImplementation as unknown as typeof api.GET);
    mockedGet.mockResolvedValueOnce({
      data: [metz],
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    const { rerender, unmount } = render(
      <CityAutocomplete value="Lux" onChangeText={jest.fn()} onSelectCity={jest.fn()} />,
    );
    jest.advanceTimersByTime(250);
    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    rerender(<CityAutocomplete value="Met" onChangeText={jest.fn()} onSelectCity={jest.fn()} />);

    expect(capturedSignal?.aborted).toBe(true);

    unmount();
    jest.useRealTimers();
  });

  it('clears suggestions when the value is emptied', async () => {
    jest.useFakeTimers();
    mockedGet.mockResolvedValue({
      data: [luxembourg],
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    const { rerender } = render(
      <CityAutocomplete value="Lux" onChangeText={jest.fn()} onSelectCity={jest.fn()} />,
    );
    jest.advanceTimersByTime(250);
    await waitFor(() => screen.getByTestId('city-suggestion-luxembourg'));

    rerender(<CityAutocomplete value="" onChangeText={jest.fn()} onSelectCity={jest.fn()} />);

    expect(screen.queryByTestId('city-suggestion-luxembourg')).toBeNull();
    jest.useRealTimers();
  });
});
