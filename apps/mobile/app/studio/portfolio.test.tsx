import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('expo-image', () => {
  const { Image } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image };
});

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { roles: ['photographer'] } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn(), PATCH: jest.fn(), DELETE: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('../../src/lib/attachment-pickers', () => ({
  pickPortfolioPhotos: jest.fn(),
  openAppSettings: jest.fn(),
}));

jest.mock('../../src/lib/portfolio-upload', () => {
  const actual = jest.requireActual<typeof import('../../src/lib/portfolio-upload')>(
    '../../src/lib/portfolio-upload',
  );
  return { ...actual, uploadPortfolioImage: jest.fn(), attachPortfolioImage: jest.fn() };
});

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';
import { pickPortfolioPhotos } from '../../src/lib/attachment-pickers';
import {
  PortfolioUploadError,
  attachPortfolioImage,
  uploadPortfolioImage,
} from '../../src/lib/portfolio-upload';

const mockedGet = jest.mocked(api.GET);
const mockedPatch = jest.mocked(api.PATCH);
const mockedDelete = jest.mocked(api.DELETE);
const mockedPick = jest.mocked(pickPortfolioPhotos);
const mockedUpload = jest.mocked(uploadPortfolioImage);
const mockedAttach = jest.mocked(attachPortfolioImage);

function makeImage(
  id: string,
  order: number,
  status = 'approved',
  url: string | null = `https://cdn/${id}.jpg`,
) {
  return { id, order, status, url, width: 100, height: 100, provenance: null };
}

function listOf(...images: object[]) {
  return {
    data: { items: images, nextCursor: null },
    error: undefined,
    response: new Response(null, { status: 200 }),
  };
}

function failed(status: number) {
  return { data: undefined, error: {}, response: new Response(null, { status }) };
}

function open() {
  renderRouter('./app', { initialUrl: '/studio/portfolio' });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('studio portfolio', () => {
  it('lists images with a badge per image status', async () => {
    mockedGet.mockResolvedValueOnce(
      listOf(
        makeImage('a', 0, 'approved'),
        makeImage('b', 1, 'pending_review'),
        makeImage('c', 2, 'flagged'),
        makeImage('d', 3, 'processing', null),
      ),
    );
    open();

    await screen.findByTestId('portfolio-image-a');
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Pending review')).toBeTruthy();
    expect(screen.getByText('Flagged')).toBeTruthy();
    expect(screen.getAllByText('Processing').length).toBeGreaterThan(0);
    expect(screen.getByTestId('portfolio-image-d-processing')).toBeTruthy();
  });

  it('states that location data in originals stays private before upload', async () => {
    mockedGet.mockResolvedValueOnce(listOf());
    open();

    const notice = await screen.findByTestId('portfolio-original-notice');
    expect(notice.props.children).toMatch(/Location data in the original stays private/);
    await screen.findByTestId('portfolio-empty');
  });

  it('shows an error with retry, then recovers', async () => {
    mockedGet.mockResolvedValueOnce(failed(500)).mockResolvedValueOnce(listOf());
    open();

    fireEvent.press(await screen.findByTestId('portfolio-retry'));

    await screen.findByTestId('portfolio-empty');
  });

  it('offers profile creation when there is no profile yet', async () => {
    mockedGet.mockResolvedValueOnce(failed(404));
    open();

    await screen.findByTestId('portfolio-needs-profile');
    expect(screen.getByTestId('portfolio-create-profile')).toBeTruthy();
  });

  it('shows a session message on 401', async () => {
    mockedGet.mockResolvedValueOnce(failed(401));
    open();

    await screen.findByTestId('portfolio-unauthorized');
  });

  it('moves an image down and keeps the order the server returns', async () => {
    mockedGet.mockResolvedValueOnce(listOf(makeImage('a', 0), makeImage('b', 1)));
    mockedPatch.mockResolvedValueOnce({
      data: { items: [makeImage('b', 0), makeImage('a', 1)], nextCursor: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);
    open();

    fireEvent.press(await screen.findByTestId('portfolio-down-a'));

    await waitFor(() => {
      expect(mockedPatch).toHaveBeenCalledWith('/v1/me/photographer-profile/portfolio/order', {
        body: { imageIds: ['b', 'a'] },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('portfolio-up-b')).toBeDisabled();
    });
  });

  it('reverts a failed reorder and says so', async () => {
    mockedGet.mockResolvedValueOnce(listOf(makeImage('a', 0), makeImage('b', 1)));
    mockedPatch.mockResolvedValueOnce(failed(500) as never);
    open();

    fireEvent.press(await screen.findByTestId('portfolio-down-a'));

    await screen.findByTestId('portfolio-reorder-error');
    expect(screen.getByTestId('portfolio-up-a')).toBeDisabled();
  });

  it('deletes an image only after confirmation', async () => {
    mockedGet.mockResolvedValueOnce(listOf(makeImage('a', 0), makeImage('b', 1)));
    mockedDelete.mockResolvedValueOnce({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    });
    open();

    fireEvent.press(await screen.findByTestId('portfolio-delete-a'));
    expect(mockedDelete).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByTestId('portfolio-delete-a-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('portfolio-image-a')).toBeNull();
    });
    expect(mockedDelete).toHaveBeenCalledWith('/v1/me/photographer-profile/portfolio/{imageId}', {
      params: { path: { imageId: 'a' } },
    });
    expect(screen.getByTestId('portfolio-image-b')).toBeTruthy();
  });

  it('keeps the image and shows an error when delete fails', async () => {
    mockedGet.mockResolvedValueOnce(listOf(makeImage('a', 0)));
    mockedDelete.mockResolvedValueOnce({
      data: undefined,
      error: { code: 'FORBIDDEN' },
      response: new Response(null, { status: 403 }),
    });
    open();

    fireEvent.press(await screen.findByTestId('portfolio-delete-a'));
    fireEvent.press(await screen.findByTestId('portfolio-delete-a-confirm'));

    await screen.findByTestId('portfolio-delete-error');
    expect(screen.getByTestId('portfolio-image-a')).toBeTruthy();
  });

  it('uploads picked photos, showing progress then adding the image', async () => {
    mockedGet.mockResolvedValueOnce(listOf());
    mockedPick.mockResolvedValueOnce({
      status: 'picked',
      files: [{ uri: 'file:///p.jpg', name: 'p.jpg', mimeType: 'image/jpeg' }],
    });
    mockedUpload.mockImplementationOnce(async (_file, handlers) => {
      handlers.onProgress(40);
      await new Promise((resolve) => setTimeout(resolve, 0));
      handlers.onStageChange('attaching');
      return makeImage('new', 0, 'processing', null) as never;
    });
    open();

    fireEvent.press(await screen.findByTestId('portfolio-upload'));

    await screen.findByTestId('portfolio-image-new');
    expect(mockedUpload).toHaveBeenCalledTimes(1);
  });

  it('shows a 422 while scanning as a state and retries only the attach', async () => {
    mockedGet.mockResolvedValueOnce(listOf());
    mockedPick.mockResolvedValueOnce({
      status: 'picked',
      files: [{ uri: 'file:///p.jpg', name: 'p.jpg', mimeType: 'image/jpeg' }],
    });
    mockedUpload.mockRejectedValueOnce(
      new PortfolioUploadError('scanPending', 'scanning', { uploadId: 'up1' }),
    );
    mockedAttach.mockResolvedValueOnce(makeImage('new', 0, 'processing', null) as never);
    open();

    fireEvent.press(await screen.findByTestId('portfolio-upload'));

    await screen.findByText('The file is still being scanned. Try again in a moment.');
    fireEvent.press(screen.getByTestId(/portfolio-upload-retry-/));

    await screen.findByTestId('portfolio-image-new');
    expect(mockedAttach).toHaveBeenCalledWith('up1');
    expect(mockedUpload).toHaveBeenCalledTimes(1);
  });

  it('does not offer retry for an infected file but allows dismissing it', async () => {
    mockedGet.mockResolvedValueOnce(listOf());
    mockedPick.mockResolvedValueOnce({
      status: 'picked',
      files: [{ uri: 'file:///p.jpg', name: 'p.jpg', mimeType: 'image/jpeg' }],
    });
    mockedUpload.mockRejectedValueOnce(new PortfolioUploadError('infected', 'bad'));
    open();

    fireEvent.press(await screen.findByTestId('portfolio-upload'));

    await screen.findByText("This file failed a virus scan and wasn't added.");
    expect(screen.queryByTestId(/portfolio-upload-retry-/)).toBeNull();
    fireEvent.press(screen.getByTestId(/portfolio-upload-dismiss-/));
    await waitFor(() => {
      expect(screen.queryByTestId(/portfolio-upload-status-/)).toBeNull();
    });
  });

  it('explains denied photo library access', async () => {
    mockedGet.mockResolvedValueOnce(listOf());
    mockedPick.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    open();

    fireEvent.press(await screen.findByTestId('portfolio-upload'));

    await screen.findByTestId('portfolio-library-denied');
  });
});
