import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { roles: ['photographer'] } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn(), PATCH: jest.fn(), DELETE: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('../../src/lib/attachment-pickers', () => ({
  pickVerificationDocument: jest.fn(),
  openAppSettings: jest.fn(),
}));

jest.mock('../../src/lib/verification-upload', () => {
  const actual = jest.requireActual<typeof import('../../src/lib/verification-upload')>(
    '../../src/lib/verification-upload',
  );
  return {
    ...actual,
    uploadVerificationDocument: jest.fn(),
    attachVerificationDocument: jest.fn(),
  };
});

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';
import { openAppSettings, pickVerificationDocument } from '../../src/lib/attachment-pickers';
import {
  VerificationUploadError,
  attachVerificationDocument,
  uploadVerificationDocument,
} from '../../src/lib/verification-upload';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);
const mockedPatch = jest.mocked(api.PATCH);
const mockedPick = jest.mocked(pickVerificationDocument);
const mockedUpload = jest.mocked(uploadVerificationDocument);
const mockedAttach = jest.mocked(attachVerificationDocument);
const mockedSettings = jest.mocked(openAppSettings);

const requirements = {
  countryCode: 'LU',
  documents: [
    {
      key: 'id_card',
      label: { en: 'Identity card' },
      description: null,
      acceptedMimeTypes: ['image/jpeg', 'application/pdf'],
    },
    {
      key: 'trade_licence',
      label: { en: 'Trade licence' },
      description: 'Autorisation',
      acceptedMimeTypes: ['application/pdf'],
    },
  ],
};

function makeDocument(documentKey: string, virusScanStatus = 'clean') {
  return {
    id: `doc-${documentKey}`,
    documentKey,
    mimeType: 'image/jpeg',
    virusScanStatus,
    uploadedAt: '2026-10-01T10:00:00.000Z',
  };
}

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case1',
    countryCode: 'LU',
    status: 'draft',
    documents: [],
    submittedAt: null,
    decidedAt: null,
    rejectionReason: null,
    businessName: 'Studio Lux',
    vatNumber: null,
    businessRegistrationNumber: null,
    ...overrides,
  };
}

function ok(data: unknown, status = 200) {
  return { data, error: undefined, response: new Response(null, { status }) };
}

function failed(status: number, error: object = {}) {
  return { data: undefined, error, response: new Response(null, { status }) };
}

function mockLoad(verificationCase: unknown) {
  mockedGet.mockImplementation(((path: string) => {
    if (path === '/v1/me/photographer-profile') {
      return Promise.resolve(ok({ countryCode: 'LU' }));
    }
    if (path === '/v1/countries/{code}/verification-requirements') {
      return Promise.resolve(ok(requirements));
    }
    return Promise.resolve(verificationCase ? ok(verificationCase) : failed(404));
  }) as never);
}

function open() {
  renderRouter('./app', { initialUrl: '/studio/verification' });
}

const photoFile = { uri: 'file:///id.jpg', name: 'id.jpg', mimeType: 'image/jpeg' };

beforeEach(() => {
  jest.resetAllMocks();
});

describe('studio verification', () => {
  it('renders one slot per required document with its status', async () => {
    mockLoad(makeCase({ documents: [makeDocument('id_card')] }));
    open();

    await screen.findByTestId('verification-slot-id_card');
    expect(screen.getByText('Identity card')).toBeTruthy();
    expect(screen.getByText('Trade licence')).toBeTruthy();
    expect(screen.getByTestId('verification-slot-status-id_card').props.children).toBe('Added');
    expect(screen.getByTestId('verification-slot-status-trade_licence').props.children).toBe(
      'Not added',
    );
  });

  it('offers camera and library only where images are accepted', async () => {
    mockLoad(makeCase());
    open();

    await screen.findByTestId('verification-slot-id_card');
    expect(screen.getByTestId('verification-camera-id_card')).toBeTruthy();
    expect(screen.getByTestId('verification-library-id_card')).toBeTruthy();
    expect(screen.queryByTestId('verification-camera-trade_licence')).toBeNull();
    expect(screen.getByTestId('verification-files-trade_licence')).toBeTruthy();
  });

  it('starts a case with the business details when none exists', async () => {
    mockLoad(null);
    mockedPost.mockResolvedValueOnce(ok(makeCase(), 201));
    open();

    await screen.findByTestId('verification-needs-case');
    fireEvent.changeText(screen.getByTestId('verification-businessName'), ' Studio Lux ');
    fireEvent.press(screen.getByTestId('verification-save-details'));

    await screen.findByTestId('verification-details-saved');
    expect(mockedPost).toHaveBeenCalledWith('/v1/me/verification-case', {
      body: { businessName: 'Studio Lux' },
    });
    expect(screen.getByTestId('verification-slot-id_card')).toBeTruthy();
  });

  it('updates the details of an existing draft with PATCH', async () => {
    mockLoad(makeCase());
    mockedPatch.mockResolvedValueOnce(ok(makeCase({ vatNumber: 'LU123' })) as never);
    open();

    fireEvent.changeText(await screen.findByTestId('verification-vatNumber'), 'LU123');
    fireEvent.press(screen.getByTestId('verification-save-details'));

    await screen.findByTestId('verification-details-saved');
    expect(mockedPatch).toHaveBeenCalledWith('/v1/me/verification-case', {
      body: { businessName: 'Studio Lux', vatNumber: 'LU123' },
    });
  });

  it('uploads a picked photo and shows the attached document', async () => {
    mockLoad(makeCase());
    mockedPick.mockResolvedValueOnce({ status: 'picked', files: [photoFile] });
    mockedUpload.mockResolvedValueOnce(makeDocument('id_card') as never);
    open();

    fireEvent.press(await screen.findByTestId('verification-library-id_card'));

    await waitFor(() => {
      expect(screen.getByTestId('verification-slot-status-id_card').props.children).toBe('Added');
    });
    expect(mockedUpload).toHaveBeenCalledWith(
      photoFile,
      expect.objectContaining({ key: 'id_card' }),
      expect.anything(),
    );
  });

  it('shows a 422 while scanning as a state and retries the attach without re-uploading', async () => {
    mockLoad(makeCase());
    mockedPick.mockResolvedValueOnce({ status: 'picked', files: [photoFile] });
    mockedUpload.mockRejectedValueOnce(
      new VerificationUploadError('scanPending', 'scanning', { uploadId: 'up1' }),
    );
    mockedAttach.mockResolvedValueOnce(makeDocument('id_card') as never);
    open();

    fireEvent.press(await screen.findByTestId('verification-library-id_card'));

    await screen.findByText('The file is still being scanned. Try again in a moment.');
    fireEvent.press(screen.getByTestId('verification-slot-retry-id_card'));

    await waitFor(() => {
      expect(screen.getByTestId('verification-slot-status-id_card').props.children).toBe('Added');
    });
    expect(mockedAttach).toHaveBeenCalledWith('up1', 'id_card');
    expect(mockedUpload).toHaveBeenCalledTimes(1);
  });

  it('supports a denied permission with a path to settings', async () => {
    mockLoad(makeCase());
    mockedPick.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    open();

    fireEvent.press(await screen.findByTestId('verification-camera-id_card'));

    await screen.findByTestId('verification-denied-id_card');
    fireEvent.press(screen.getByText('Open settings'));
    expect(mockedSettings).toHaveBeenCalled();
  });

  it('disables submit until every required slot holds a clean document', async () => {
    mockLoad(
      makeCase({ documents: [makeDocument('id_card'), makeDocument('trade_licence', 'pending')] }),
    );
    open();

    const submit = await screen.findByTestId('verification-submit');
    fireEvent.press(submit);
    expect(screen.queryByTestId('verification-submit-panel')).toBeNull();
    expect(screen.getByTestId('verification-submit-hint')).toBeTruthy();
  });

  it('asks for confirmation and submits once even when confirmed twice', async () => {
    mockLoad(makeCase({ documents: [makeDocument('id_card'), makeDocument('trade_licence')] }));
    let resolveSubmit: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    open();

    fireEvent.press(await screen.findByTestId('verification-submit'));
    expect(mockedPost).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('verification-submit-confirm'));
    fireEvent.press(screen.getByTestId('verification-submit-confirm'));
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith('/v1/me/verification-case/submit');

    resolveSubmit(
      ok(makeCase({ status: 'submitted', submittedAt: '2026-10-07T10:00:00.000Z', documents: [] })),
    );
    await waitFor(() => {
      expect(screen.getByTestId('verification-status-label').props.children).toBe(
        'Submitted, waiting for review',
      );
    });
  });

  it('becomes read-only once submitted', async () => {
    mockLoad(
      makeCase({
        status: 'in_review',
        submittedAt: '2026-10-07T10:00:00.000Z',
        documents: [makeDocument('id_card'), makeDocument('trade_licence')],
      }),
    );
    open();

    await screen.findByTestId('verification-read-only');
    expect(screen.queryByTestId('verification-submit')).toBeNull();
    expect(screen.queryByTestId('verification-business-form')).toBeNull();
    expect(screen.queryByTestId('verification-library-id_card')).toBeNull();
    expect(screen.queryByTestId('verification-files-trade_licence')).toBeNull();
  });

  it('shows the rejection reason and offers a new case', async () => {
    mockLoad(
      makeCase({
        status: 'rejected',
        decidedAt: '2026-10-07T10:00:00.000Z',
        rejectionReason: 'The ID photo is blurry',
      }),
    );
    open();

    await screen.findByTestId('verification-rejection');
    expect(screen.getByText(/The ID photo is blurry/)).toBeTruthy();
    expect(screen.getByTestId('verification-start-new')).toBeTruthy();
    expect(screen.queryByTestId('verification-submit')).toBeNull();
  });

  it('shows a load error with a retry that recovers', async () => {
    mockedGet.mockResolvedValueOnce(failed(500));
    open();
    const retry = await screen.findByTestId('verification-retry');
    mockLoad(makeCase());
    fireEvent.press(retry);
    await screen.findByTestId('verification-slot-id_card');
  });

  it('shows a session message on 401', async () => {
    mockedGet.mockResolvedValueOnce(failed(401));
    open();
    await screen.findByTestId('verification-unauthorized');
  });

  it('offers profile creation when there is no profile', async () => {
    mockedGet.mockResolvedValueOnce(failed(404));
    open();
    await screen.findByTestId('verification-needs-profile');
  });

  it('explains when the country has no requirements', async () => {
    mockedGet.mockImplementation(((path: string) =>
      Promise.resolve(
        path === '/v1/me/photographer-profile' ? ok({ countryCode: 'ZZ' }) : failed(404),
      )) as never);
    open();
    await screen.findByTestId('verification-country-unavailable');
  });
});
