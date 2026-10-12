import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

const mockSignOut = jest.fn<() => Promise<void>>();
jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ status: 'signed-in', signOut: mockSignOut }),
}));

import '../../lib/i18n';
import { api } from '../../lib/api';
import { DeleteAccount } from './delete-account';

const mockedPost = jest.mocked(api.POST);

const DELETION = {
  id: 'dr-1',
  type: 'delete',
  status: 'pending',
  channel: 'in_app',
  requestedAt: '2027-01-09T00:00:00.000Z',
  receivedAt: '2027-01-09T00:00:00.000Z',
  completedAt: null,
  expiresAt: null,
  failureReason: null,
  cancelledAt: null,
};

function reply(status: number, body: object) {
  return Promise.resolve({
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  });
}

function confirm() {
  fireEvent.press(screen.getByTestId('account-deletion'));
  fireEvent.press(screen.getByTestId('account-deletion-confirm'));
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSignOut.mockResolvedValue();
  render(<DeleteAccount />);
});

describe('DeleteAccount', () => {
  it('explains the consequences before asking for confirmation', () => {
    fireEvent.press(screen.getByTestId('account-deletion'));

    expect(screen.getByText(/deactivated immediately/)).toBeTruthy();
    expect(screen.getByText(/30-day grace period/)).toBeTruthy();
    expect(screen.getByText(/link to cancel the deletion/)).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('does not call the API when the user backs out', () => {
    fireEvent.press(screen.getByTestId('account-deletion'));
    fireEvent.press(screen.getByTestId('account-deletion-dismiss'));

    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('creates the deletion request and signs out on 201', async () => {
    mockedPost.mockReturnValue(reply(201, DELETION));
    confirm();

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
    expect(mockedPost).toHaveBeenCalledWith('/v1/me/data-requests', { body: { type: 'delete' } });
  });

  it('signs out when the API returns the existing pending row with 200', async () => {
    mockedPost.mockReturnValue(reply(200, DELETION));
    confirm();

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    [
      409,
      { code: 'CONFLICT', details: { reason: 'VERIFICATION_IN_REVIEW' } },
      /identity verification is in review/,
    ],
    [
      409,
      { code: 'CONFLICT', details: { reason: 'ACCEPTED_QUOTE_WITHDRAWAL_WINDOW' } },
      /accepted quote is still inside the withdrawal period/,
    ],
    [409, { code: 'CONFLICT' }, /can't be deleted right now/],
    [422, { code: 'UNPROCESSABLE_ENTITY' }, /couldn't process this request/],
    [400, { code: 'VALIDATION_ERROR' }, /couldn't process this request/],
    [401, { code: 'UNAUTHORIZED' }, /session has ended/],
    [429, { code: 'TOO_MANY_REQUESTS' }, /Too many attempts\. Please try again later/],
    [
      429,
      { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 30 } },
      /try again in 30 seconds/,
    ],
    [500, { code: 'INTERNAL_SERVER_ERROR' }, /Something went wrong/],
  ])('maps %i %j to its message without signing out', async (status, body, message) => {
    mockedPost.mockReturnValue(reply(status, body));
    confirm();

    expect(await screen.findByTestId('account-deletion-error')).toHaveTextContent(message);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('shows the generic error when the request throws', async () => {
    mockedPost.mockRejectedValue(new Error('offline'));
    confirm();

    expect(await screen.findByTestId('account-deletion-error')).toHaveTextContent(
      /Something went wrong/,
    );
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('sends one request for a double tap on confirm', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.press(screen.getByTestId('account-deletion'));
    fireEvent.press(screen.getByTestId('account-deletion-confirm'));
    fireEvent.press(screen.getByTestId('account-deletion-confirm'));
    expect(mockedPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        data: DELETION,
        error: undefined,
        response: new Response(null, { status: 201 }),
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });
});
