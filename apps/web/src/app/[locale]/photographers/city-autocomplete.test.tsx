import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiGetMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));

async function loadCityAutocomplete() {
  const { CityAutocomplete } = await import('./city-autocomplete');
  return CityAutocomplete;
}

describe('CityAutocomplete', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    apiGetMock.mockReset();
  });

  it('does not query before the debounce window elapses', async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    const CityAutocomplete = await loadCityAutocomplete();
    render(<CityAutocomplete label="City" name="city" />);

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Lux' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('queries /v1/cities once the debounce window elapses', async () => {
    apiGetMock.mockResolvedValue({
      data: [
        {
          slug: 'luxembourg-city',
          name: 'Luxembourg City',
          countryCode: 'LU',
          photographerCount: 3,
        },
      ],
    });
    const CityAutocomplete = await loadCityAutocomplete();
    render(<CityAutocomplete label="City" name="city" countryCode="LU" />);

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Lux' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(apiGetMock).toHaveBeenCalledWith('/v1/cities', {
      params: { query: { q: 'Lux', limit: 5, countryCode: 'LU' } },
    });
    expect(screen.getByRole('option', { hidden: true })).toHaveAttribute(
      'value',
      'Luxembourg City',
    );
  });

  it('does not re-query while typing within the debounce window', async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    const CityAutocomplete = await loadCityAutocomplete();
    render(<CityAutocomplete label="City" name="city" />);

    const input = screen.getByLabelText('City');
    fireEvent.change(input, { target: { value: 'Lu' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(input, { target: { value: 'Lux' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledWith('/v1/cities', {
      params: { query: { q: 'Lux', limit: 5 } },
    });
  });

  it('clears suggestions instead of throwing when the API call fails', async () => {
    apiGetMock.mockRejectedValue(new Error('network error'));
    const CityAutocomplete = await loadCityAutocomplete();
    render(<CityAutocomplete label="City" name="city" />);

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Lux' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('option', { hidden: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText('City')).toHaveValue('Lux');
  });

  it('clears suggestions once the input is emptied', async () => {
    apiGetMock.mockResolvedValue({
      data: [
        {
          slug: 'luxembourg-city',
          name: 'Luxembourg City',
          countryCode: 'LU',
          photographerCount: 3,
        },
      ],
    });
    const CityAutocomplete = await loadCityAutocomplete();
    render(<CityAutocomplete label="City" name="city" />);

    const input = screen.getByLabelText('City');
    fireEvent.change(input, { target: { value: 'Lux' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByRole('option', { hidden: true })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.queryByRole('option', { hidden: true })).not.toBeInTheDocument();
  });

  it('calls onCitySelect with the matching suggestion once the typed value matches it exactly', async () => {
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
    const onCitySelect = vi.fn();
    const CityAutocomplete = await loadCityAutocomplete();
    render(<CityAutocomplete label="City" name="city" onCitySelect={onCitySelect} />);

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'luxembourg city' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(onCitySelect).toHaveBeenLastCalledWith({
      slug: 'luxembourg-city',
      name: 'Luxembourg City',
      countryCode: 'LU',
      photographerCount: 3,
      location: { lat: 49.61, lng: 6.13 },
    });
  });

  it('calls onCitySelect with null once the typed value stops matching a suggestion', async () => {
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
    const onCitySelect = vi.fn();
    const CityAutocomplete = await loadCityAutocomplete();
    render(<CityAutocomplete label="City" name="city" onCitySelect={onCitySelect} />);
    const input = screen.getByLabelText('City');

    fireEvent.change(input, { target: { value: 'Luxembourg City' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    onCitySelect.mockClear();

    fireEvent.change(input, { target: { value: 'Luxembourg Cit' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(onCitySelect).toHaveBeenLastCalledWith(null);
  });
});
