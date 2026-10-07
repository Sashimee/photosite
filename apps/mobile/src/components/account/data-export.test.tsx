import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const { useEffect: useMockEffect } = jest.requireActual<typeof import('react')>('react');
    useMockEffect(effect, [effect]);
  },
}));

import '../../lib/i18n';
import * as WebBrowser from 'expo-web-browser';

import { api } from '../../lib/api';
import { DataExport } from './data-export';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);
const mockedOpen = jest.mocked(WebBrowser.openBrowserAsync);

const URL = 'https://storage.photoo.lu/exports/abc123?signature=xyz';
const FUTURE = '2999-01-01T00:00:00.000Z';

function exportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dr-1',
    type: 'export',
    status: 'pending',
    channel: 'in_app',
    requestedAt: '2027-01-09T00:00:00.000Z',
    receivedAt: '2027-01-09T00:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    failureReason: null,
    cancelledAt: null,
    ...overrides,
  };
}

function reply(status: number, body: object) {
  return Promise.resolve({
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  });
}

function listReturns(rows: object[]) {
  mockedGet.mockImplementation(((path: string) =>
    path === '/v1/me/data-requests' ? reply(200, rows) : reply(500, {})) as never);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedOpen.mockResolvedValue({ type: 'opened' } as never);
});

describe('DataExport status', () => {
  it('loads the list on focus and offers a request when there is no export', async () => {
    listReturns([]);
    render(<DataExport />);

    expect(await screen.findByTestId('account-export-status')).toHaveTextContent(
      /No export requested yet/,
    );
    expect(mockedGet).toHaveBeenCalledWith('/v1/me/data-requests');
    expect(screen.getByTestId('account-export-request')).toBeTruthy();
    expect(screen.queryByTestId('account-export-download')).toBeNull();
  });

  it.each([
    ['pending', /queued/],
    ['processing', /being prepared/],
  ])('shows %s without any action', async (status, message) => {
    listReturns([exportRow({ status })]);
    render(<DataExport />);

    expect(await screen.findByTestId('account-export-status')).toHaveTextContent(message);
    expect(screen.queryByTestId('account-export-request')).toBeNull();
    expect(screen.queryByTestId('account-export-download')).toBeNull();
  });

  it('shows ready with a download button', async () => {
    listReturns([exportRow({ status: 'ready', expiresAt: FUTURE })]);
    render(<DataExport />);

    expect(await screen.findByTestId('account-export-status')).toHaveTextContent(/ready/);
    expect(screen.getByTestId('account-export-download')).toBeTruthy();
    expect(screen.queryByTestId('account-export-request')).toBeNull();
  });

  it('shows failed and allows a new request', async () => {
    listReturns([exportRow({ status: 'failed', failureReason: 'export_failed' })]);
    render(<DataExport />);

    expect(await screen.findByTestId('account-export-status')).toHaveTextContent(/failed/);
    expect(screen.getByTestId('account-export-request')).toBeTruthy();
  });

  it.each([
    [
      'a ready export past expiresAt',
      exportRow({ status: 'ready', expiresAt: '2000-01-01T00:00:00.000Z' }),
    ],
    ['a ready export whose file was swept', exportRow({ status: 'ready', expiresAt: null })],
  ])('shows expired for %s and allows a new request', async (_name, row) => {
    listReturns([row]);
    render(<DataExport />);

    expect(await screen.findByTestId('account-export-status')).toHaveTextContent(/expired/);
    expect(screen.getByTestId('account-export-request')).toBeTruthy();
    expect(screen.queryByTestId('account-export-download')).toBeNull();
  });

  it('uses the newest export and ignores deletion rows', async () => {
    listReturns([
      exportRow({ id: 'del', type: 'delete', status: 'ready', expiresAt: FUTURE }),
      exportRow({ id: 'new', status: 'processing' }),
      exportRow({ id: 'old', status: 'failed' }),
    ]);
    render(<DataExport />);

    expect(await screen.findByTestId('account-export-status')).toHaveTextContent(/being prepared/);
  });

  it('refreshes the status from the refresh button', async () => {
    listReturns([exportRow({ status: 'pending' })]);
    render(<DataExport />);
    await screen.findByText(/queued/);

    listReturns([exportRow({ status: 'ready', expiresAt: FUTURE })]);
    fireEvent.press(screen.getByTestId('account-export-refresh'));

    expect(await screen.findByText(/ready to download/)).toBeTruthy();
  });

  it('shows an error and no status when the list fails', async () => {
    mockedGet.mockReturnValue(reply(401, { code: 'UNAUTHORIZED' }));
    render(<DataExport />);

    expect(await screen.findByTestId('account-export-error')).toHaveTextContent(
      /session has ended/,
    );
    expect(screen.queryByTestId('account-export-status')).toBeNull();
    expect(screen.queryByTestId('account-export-request')).toBeNull();
  });

  it('shows the generic error when the list throws', async () => {
    mockedGet.mockRejectedValue(new Error('offline'));
    render(<DataExport />);

    expect(await screen.findByTestId('account-export-error')).toHaveTextContent(
      /Something went wrong/,
    );
  });
});

describe('DataExport request', () => {
  beforeEach(() => {
    listReturns([]);
  });

  it('creates an export and shows it as queued on 201', async () => {
    mockedPost.mockReturnValue(reply(201, exportRow()));
    render(<DataExport />);

    fireEvent.press(await screen.findByTestId('account-export-request'));

    expect(await screen.findByText(/queued/)).toBeTruthy();
    expect(mockedPost).toHaveBeenCalledWith('/v1/me/data-requests', { body: { type: 'export' } });
  });

  it('shows the existing row returned with 200', async () => {
    mockedPost.mockReturnValue(reply(200, exportRow({ status: 'processing' })));
    render(<DataExport />);

    fireEvent.press(await screen.findByTestId('account-export-request'));

    expect(await screen.findByText(/being prepared/)).toBeTruthy();
  });

  it.each([
    [429, { code: 'TOO_MANY_REQUESTS' }, /one export per 24 hours\. Please try again later/],
    [
      429,
      { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 90 } },
      /try again in 90 seconds/,
    ],
    [409, { code: 'CONFLICT' }, /isn't ready yet/],
    [422, { code: 'UNPROCESSABLE_ENTITY' }, /couldn't process this request/],
    [400, { code: 'VALIDATION_ERROR' }, /couldn't process this request/],
    [401, { code: 'UNAUTHORIZED' }, /session has ended/],
    [500, { code: 'INTERNAL_SERVER_ERROR' }, /Something went wrong/],
  ])('maps %i %j to its message', async (status, body, message) => {
    mockedPost.mockReturnValue(reply(status, body));
    render(<DataExport />);

    fireEvent.press(await screen.findByTestId('account-export-request'));

    expect(await screen.findByTestId('account-export-error')).toHaveTextContent(message);
    expect(screen.getByTestId('account-export-status')).toHaveTextContent(/No export requested/);
  });

  it('sends one request for a double tap', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<DataExport />);

    const button = await screen.findByTestId('account-export-request');
    fireEvent.press(button);
    fireEvent.press(button);
    expect(mockedPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        data: exportRow(),
        error: undefined,
        response: new Response(null, { status: 201 }),
      });
      await Promise.resolve();
    });
  });
});

describe('DataExport download', () => {
  beforeEach(() => {
    listReturns([exportRow({ status: 'ready', expiresAt: FUTURE })]);
  });

  function downloadReturns(response: Promise<unknown>) {
    mockedGet.mockImplementation(((path: string) =>
      path === '/v1/me/data-requests'
        ? reply(200, [exportRow({ status: 'ready', expiresAt: FUTURE })])
        : response) as never);
  }

  it('fetches the presigned URL and opens it in the browser', async () => {
    downloadReturns(reply(200, { url: URL, expiresAt: FUTURE }));
    render(<DataExport />);

    fireEvent.press(await screen.findByTestId('account-export-download'));

    await waitFor(() => {
      expect(mockedOpen).toHaveBeenCalledWith(URL);
    });
    expect(mockedGet).toHaveBeenCalledWith('/v1/me/data-requests/{id}/download', {
      params: { path: { id: 'dr-1' } },
    });
  });

  it.each(['http://storage.photoo.lu/export.zip', 'javascript:alert(1)', 'not a url'])(
    'refuses to open %s',
    async (url) => {
      downloadReturns(reply(200, { url, expiresAt: FUTURE }));
      render(<DataExport />);

      fireEvent.press(await screen.findByTestId('account-export-download'));

      expect(await screen.findByTestId('account-export-error')).toHaveTextContent(
        /Something went wrong/,
      );
      expect(mockedOpen).not.toHaveBeenCalled();
    },
  );

  it.each([
    [409, { code: 'CONFLICT' }, /isn't ready yet/],
    [410, { code: 'GONE' }, /download has expired/],
    [403, { code: 'FORBIDDEN' }, /don't have access/],
    [404, { code: 'NOT_FOUND' }, /could not be found/],
    [401, { code: 'UNAUTHORIZED' }, /session has ended/],
  ])('maps %i to its message', async (status, body, message) => {
    downloadReturns(reply(status, body));
    render(<DataExport />);

    fireEvent.press(await screen.findByTestId('account-export-download'));

    expect(await screen.findByTestId('account-export-error')).toHaveTextContent(message);
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('shows the generic error when the browser fails to open', async () => {
    downloadReturns(reply(200, { url: URL, expiresAt: FUTURE }));
    mockedOpen.mockRejectedValue(new Error('no browser'));
    render(<DataExport />);

    fireEvent.press(await screen.findByTestId('account-export-download'));

    expect(await screen.findByTestId('account-export-error')).toHaveTextContent(
      /Something went wrong/,
    );
  });

  it('requests the URL once for a double tap', async () => {
    let finish: (value: unknown) => void = () => undefined;
    downloadReturns(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<DataExport />);

    const button = await screen.findByTestId('account-export-download');
    fireEvent.press(button);
    fireEvent.press(button);
    expect(mockedGet).toHaveBeenCalledTimes(2);

    await act(async () => {
      finish({
        data: { url: URL, expiresAt: FUTURE },
        error: undefined,
        response: new Response(null, { status: 200 }),
      });
      await Promise.resolve();
    });
  });
});
