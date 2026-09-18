import { describe, expect, it, jest } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

describe('guarded tabs', () => {
  it('discover stays public while signed out', async () => {
    renderRouter('./app', { initialUrl: '/' });

    await waitFor(() => {
      expect(screen.getAllByText('Discover').length).toBeGreaterThan(0);
    });
  });

  it('redirects requests to sign-in while signed out', async () => {
    renderRouter('./app', { initialUrl: '/requests' });

    await waitFor(() => screen.getByTestId('sign-in-submit'));
  });

  it('redirects messages to sign-in while signed out', async () => {
    renderRouter('./app', { initialUrl: '/messages' });

    await waitFor(() => screen.getByTestId('sign-in-submit'));
  });

  it('redirects account to sign-in while signed out', async () => {
    renderRouter('./app', { initialUrl: '/account' });

    await waitFor(() => screen.getByTestId('sign-in-submit'));
  });
});
