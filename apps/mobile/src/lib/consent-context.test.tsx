import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

const mockAuth = { current: { status: 'signed-out', user: null as object | null } };
jest.mock('./auth-context', () => ({
  useAuth: () => mockAuth.current,
}));

jest.mock('./api', () => ({
  api: { GET: jest.fn(), POST: jest.fn(), PUT: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('./consent-sync', () => jest.requireActual('./consent-sync'));

import '../lib/i18n';

import { ConsentPrompt } from '../components/consent/consent-prompt';
import { api } from './api';
import { ConsentProvider, useAnalyticsEnabled, useConsent } from './consent-context';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);
const mockedPut = jest.mocked(api.PUT);

const consentRecord = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  purpose: 'analytics',
  granted: true,
  policyVersion: '1',
  recordedAt: '2026-10-07T10:00:00.000Z',
};

function ok(data: unknown, status = 200) {
  return { data, error: undefined, response: new Response(null, { status }) };
}

function failure(status: number, error: unknown) {
  return { data: undefined, error, response: new Response(null, { status }) };
}

let withdraw: (() => Promise<void>) | null = null;

function Probe() {
  const enabled = useAnalyticsEnabled();
  const { decide } = useConsent();
  withdraw = () => decide({ analytics: false, adsMarketing: false });
  return <Text testID="gate">{enabled ? 'on' : 'off'}</Text>;
}

function renderApp() {
  return render(
    <ConsentProvider>
      <Probe />
      <ConsentPrompt />
    </ConsentProvider>,
  );
}

interface CallLog {
  mock: { calls: readonly (readonly unknown[])[] };
}

function pathsOf(mock: CallLog): unknown[] {
  return mock.mock.calls.map(([path]) => path);
}

function bodiesOf(mock: CallLog): Record<string, unknown>[] {
  return mock.mock.calls.map(([, init]) => (init as { body: Record<string, unknown> }).body);
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockAuth.current = { status: 'signed-out', user: null };
  mockedGet.mockResolvedValue(ok({ policyVersion: '1' }));
  mockedPost.mockResolvedValue(ok(consentRecord, 201));
  mockedPut.mockResolvedValue(ok({ consents: [] }) as never);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('analytics gate', () => {
  it('is off and the prompt is shown before any decision', async () => {
    renderApp();

    await screen.findByTestId('consent-prompt');
    expect(screen.getByTestId('gate')).toHaveTextContent('off');
    expect(screen.getByTestId('consent-analytics')).not.toBeChecked();
    expect(screen.getByTestId('consent-ads-marketing')).not.toBeChecked();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('stays off after declining with a single tap, and records every purpose as refused', async () => {
    renderApp();

    fireEvent.press(await screen.findByTestId('consent-decline-all'));

    await waitFor(() => {
      expect(screen.queryByTestId('consent-prompt')).toBeNull();
    });
    expect(screen.getByTestId('gate')).toHaveTextContent('off');
    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(3);
    });
    expect(
      bodiesOf(mockedPost as jest.Mock).map(({ purpose, granted }) => [purpose, granted]),
    ).toEqual([
      ['analytics', false],
      ['ads', false],
      ['marketing', false],
    ]);
  });

  it('turns on after accepting and off again the moment it is withdrawn', async () => {
    renderApp();

    fireEvent.press(await screen.findByTestId('consent-accept-all'));
    await waitFor(() => {
      expect(screen.getByTestId('gate')).toHaveTextContent('on');
    });

    await act(async () => {
      await withdraw?.();
    });
    expect(screen.getByTestId('gate')).toHaveTextContent('off');
  });

  it('flips off before the withdrawal reaches the API', async () => {
    renderApp();
    fireEvent.press(await screen.findByTestId('consent-accept-all'));
    await waitFor(() => {
      expect(screen.getByTestId('gate')).toHaveTextContent('on');
    });

    let release: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    let pending: Promise<void> | undefined;
    act(() => {
      pending = withdraw?.();
    });

    expect(screen.getByTestId('gate')).toHaveTextContent('off');
    release(ok(consentRecord, 201));
    await act(async () => {
      await pending;
    });
  });

  it('honours the saved decision after a restart', async () => {
    const first = renderApp();
    fireEvent.press(await screen.findByTestId('consent-accept-all'));
    await waitFor(() => {
      expect(screen.getByTestId('gate')).toHaveTextContent('on');
    });
    first.unmount();

    renderApp();

    await waitFor(() => {
      expect(screen.getByTestId('gate')).toHaveTextContent('on');
    });
    expect(screen.queryByTestId('consent-prompt')).toBeNull();
  });

  it('asks again when a newer policy version is published', async () => {
    mockStore.set(
      'photoo.consent.decision',
      JSON.stringify({
        policyVersion: '1',
        decidedAt: '2026-10-01T10:00:00.000Z',
        categories: { analytics: true, adsMarketing: false },
      }),
    );
    mockedGet.mockResolvedValue(ok({ policyVersion: '2' }));

    renderApp();

    await screen.findByTestId('consent-prompt');
  });

  it('does not ask again while the policy version is unchanged', async () => {
    mockStore.set(
      'photoo.consent.decision',
      JSON.stringify({
        policyVersion: '1',
        decidedAt: '2026-10-01T10:00:00.000Z',
        categories: { analytics: true, adsMarketing: false },
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByTestId('gate')).toHaveTextContent('on');
    });
    expect(screen.queryByTestId('consent-prompt')).toBeNull();
  });
});

describe('persistence', () => {
  it('uses the anonymous endpoint with one shared anonymousId when signed out', async () => {
    renderApp();
    fireEvent.press(await screen.findByTestId('consent-accept-all'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(3);
    });
    const bodies = bodiesOf(mockedPost);
    expect(new Set(bodies.map((body) => body.anonymousId)).size).toBe(1);
    expect(typeof bodies[0]?.anonymousId).toBe('string');
    expect(pathsOf(mockedPost)).toEqual(['/v1/consents', '/v1/consents', '/v1/consents']);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('reuses the same anonymousId for a later decision', async () => {
    renderApp();
    fireEvent.press(await screen.findByTestId('consent-accept-all'));
    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(3);
    });

    await act(async () => {
      await withdraw?.();
    });

    const ids = bodiesOf(mockedPost as jest.Mock).map((body) => body.anonymousId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(1);
  });

  it('uses PUT /v1/me/consents without an anonymousId when signed in', async () => {
    mockAuth.current = { status: 'signed-in', user: { id: 'u1' } };
    renderApp();
    fireEvent.press(await screen.findByTestId('consent-accept-all'));

    await waitFor(() => {
      expect(mockedPut).toHaveBeenCalledTimes(1);
    });
    expect(mockedPut).toHaveBeenCalledWith('/v1/me/consents', {
      body: {
        consents: [
          { purpose: 'analytics', granted: true },
          { purpose: 'ads', granted: true },
          { purpose: 'marketing', granted: true },
        ],
      },
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('never sends a policyVersion', async () => {
    renderApp();
    fireEvent.press(await screen.findByTestId('consent-accept-all'));
    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(3);
    });
    mockAuth.current = { status: 'signed-in', user: { id: 'u1' } };
    await act(async () => {
      await withdraw?.();
    });

    const sent = [...bodiesOf(mockedPost), ...bodiesOf(mockedPut)];
    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(sent)).not.toContain('policyVersion');
  });

  it('keeps the local decision and logs when the API answers with an error', async () => {
    mockedPost.mockResolvedValue(failure(500, { code: 'INTERNAL_SERVER_ERROR', message: 'unset' }));
    renderApp();

    fireEvent.press(await screen.findByTestId('consent-accept-all'));

    await waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    });
    expect(screen.getByTestId('gate')).toHaveTextContent('on');
    expect(screen.queryByTestId('consent-prompt')).toBeNull();
    expect(mockStore.get('photoo.consent.decision')).toContain('"analytics":true');
  });

  it('keeps the local decision and reports the retry delay on a 429', async () => {
    mockedPost.mockResolvedValue(
      failure(429, {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many consent updates. Try again later.',
        details: { retryAfterSeconds: 120 },
      }),
    );
    renderApp();

    fireEvent.press(await screen.findByTestId('consent-accept-all'));

    await waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('rate limited, retry after 120s'),
        expect.anything(),
      );
    });
    expect(screen.getByTestId('gate')).toHaveTextContent('on');
  });

  it('keeps the local decision when the network is down', async () => {
    mockAuth.current = { status: 'signed-in', user: { id: 'u1' } };
    mockedPut.mockRejectedValue(new TypeError('Network request failed'));
    renderApp();

    fireEvent.press(await screen.findByTestId('consent-accept-all'));

    await waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('network error'),
        expect.any(TypeError),
      );
    });
    expect(screen.getByTestId('gate')).toHaveTextContent('on');
  });

  it('still shows the prompt and gate off when the policy version cannot be loaded', async () => {
    mockedGet.mockRejectedValue(new TypeError('Network request failed'));
    renderApp();

    await screen.findByTestId('consent-prompt');
    expect(screen.getByTestId('gate')).toHaveTextContent('off');
  });
});
