import { describe, expect, it, jest } from '@jest/globals';

jest.mock('./session', () => ({
  getSessionToken: jest.fn(),
}));

import { api } from './api';
import { getSessionToken } from './session';

const mockedGetSessionToken = jest.mocked(getSessionToken);

function captureRequest(): {
  fetchStub: (request: Request) => Promise<Response>;
  get: () => Request | undefined;
} {
  let capturedRequest: Request | undefined;
  const fetchStub = (request: Request): Promise<Response> => {
    capturedRequest = request;
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  };
  return { fetchStub, get: () => capturedRequest };
}

describe('api client', () => {
  it('adds the bearer token from secure storage to outgoing requests', async () => {
    mockedGetSessionToken.mockResolvedValue('token-123');
    const { fetchStub, get } = captureRequest();

    await api.GET('/v1/photographers', { fetch: fetchStub });

    expect(get()?.headers.get('Authorization')).toBe('Bearer token-123');
  });

  it('omits the Authorization header when there is no session', async () => {
    mockedGetSessionToken.mockResolvedValue(null);
    const { fetchStub, get } = captureRequest();

    await api.GET('/v1/photographers', { fetch: fetchStub });

    expect(get()?.headers.has('Authorization')).toBe(false);
  });
});
