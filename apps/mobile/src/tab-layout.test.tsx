import { describe, expect, it } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

describe('tab layout', () => {
  it('renders the discover tab by default and lists all four tabs', async () => {
    void renderRouter('./app', { initialUrl: '/' });

    await waitFor(() => {
      expect(screen.getAllByText('Discover').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Requests').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Messages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
  });
});
