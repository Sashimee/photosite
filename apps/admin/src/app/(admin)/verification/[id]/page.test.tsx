import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const serverApiMock = vi.fn();
const getSessionMock = vi.fn();
vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock, getSession: getSessionMock }));

const headersMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock, redirect: redirectMock }));

vi.mock('next-intl/server', async () => {
  const { mockUseFormatter, translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
    getFormatter: () => mockUseFormatter(),
  };
});

const documentViewerMock = vi.fn(() => <div data-testid="document-viewer" />);
const caseActionsMock = vi.fn(() => <div data-testid="case-actions" />);
const decisionHistoryMock = vi.fn(() => <div data-testid="decision-history" />);
vi.mock('@/components/verification/document-viewer', () => ({
  DocumentViewer: documentViewerMock,
}));
vi.mock('./case-actions', () => ({ CaseActions: caseActionsMock }));
vi.mock('./decision-history', () => ({ DecisionHistory: decisionHistoryMock }));

function firstCallProps(mock: { mock: { calls: unknown[][] } }) {
  return mock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
}

function makeHeaders(pathname: string | null) {
  return { get: (name: string) => (name === 'x-pathname' ? pathname : null) };
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

const caseDetail = {
  id: 'case-1',
  countryCode: 'LU',
  status: 'in_review' as const,
  documents: [
    {
      id: 'doc-1',
      documentKey: 'id_card',
      mimeType: 'image/jpeg',
      virusScanStatus: 'clean' as const,
      uploadedAt: '2026-08-31T09:30:00.000Z',
      downloadUrl: 'https://storage.example.com/presigned/doc-1',
    },
  ],
  submittedAt: '2026-09-01T00:00:00.000Z',
  decidedAt: null,
  rejectionReason: null,
  businessName: 'Fixture Photography Sarl',
  vatNumber: 'LU12345678',
  businessRegistrationNumber: 'B123456',
  userId: 'user-1',
  assignedAdminId: 'admin-1',
  decidedByAdminId: null,
};

const admin = {
  id: 'admin-1',
  email: 'admin@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['admin'],
  status: 'active',
  twoFactorEnabled: true,
  lastLoginAt: null,
};

function apiWith(caseResult: unknown, auditResult: unknown) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/v1/admin/verification-cases/{id}') {
      return caseResult;
    }
    if (path === '/v1/admin/audit-log') {
      return auditResult;
    }
    throw new Error(`Unexpected path ${path}`);
  });
}

describe('VerificationCaseDetailPage', () => {
  it('shows the applicant identity and business fields, never handing a download URL to the client', async () => {
    headersMock.mockResolvedValue(makeHeaders('/verification/case-1'));
    getSessionMock.mockResolvedValue(admin);
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: caseDetail, response: { status: 200 } },
        { data: { items: [], nextCursor: null }, response: { status: 200 } },
      ),
    });
    const VerificationCaseDetailPage = await loadPage();

    render(await VerificationCaseDetailPage({ params: Promise.resolve({ id: 'case-1' }) }));

    expect(screen.getByText('user-1')).toBeInTheDocument();
    expect(screen.getByText('Fixture Photography Sarl')).toBeInTheDocument();
    expect(screen.getByText('LU12345678')).toBeInTheDocument();
    expect(screen.getByText('Sep 1, 2026, 2:00 AM GMT+2')).toBeInTheDocument();
    expect(screen.getByText('Uploaded Aug 31, 2026, 11:30 AM GMT+2')).toBeInTheDocument();
    expect(firstCallProps(documentViewerMock)).toMatchObject({
      caseId: 'case-1',
      document: {
        id: 'doc-1',
        documentKey: 'id_card',
        mimeType: 'image/jpeg',
        virusScanStatus: 'clean',
        uploadedAt: '2026-08-31T09:30:00.000Z',
      },
    });
    const documentProp = firstCallProps(documentViewerMock)?.document as Record<string, unknown>;
    expect(documentProp).not.toHaveProperty('downloadUrl');
  });

  it('shows decision history when the audit-log probe succeeds', async () => {
    headersMock.mockResolvedValue(makeHeaders('/verification/case-1'));
    getSessionMock.mockResolvedValue(admin);
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: caseDetail, response: { status: 200 } },
        { data: { items: [], nextCursor: null }, response: { status: 200 } },
      ),
    });
    const VerificationCaseDetailPage = await loadPage();

    render(await VerificationCaseDetailPage({ params: Promise.resolve({ id: 'case-1' }) }));

    expect(screen.getByTestId('decision-history')).toBeInTheDocument();
  });

  it('hides decision history when the audit-log probe is forbidden', async () => {
    headersMock.mockResolvedValue(makeHeaders('/verification/case-1'));
    getSessionMock.mockResolvedValue(admin);
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: caseDetail, response: { status: 200 } },
        { data: undefined, response: { status: 403 } },
      ),
    });
    const VerificationCaseDetailPage = await loadPage();

    render(await VerificationCaseDetailPage({ params: Promise.resolve({ id: 'case-1' }) }));

    expect(screen.queryByTestId('decision-history')).not.toBeInTheDocument();
  });

  it('calls notFound for a missing case', async () => {
    headersMock.mockResolvedValue(makeHeaders('/verification/missing'));
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 404 } }),
    });
    const VerificationCaseDetailPage = await loadPage();

    await expect(
      VerificationCaseDetailPage({ params: Promise.resolve({ id: 'missing' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('routes a stale second factor to re-verification and back to the case', async () => {
    headersMock.mockResolvedValue(makeHeaders('/verification/case-1'));
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({
        data: undefined,
        error: { code: 'TWO_FACTOR_REQUIRED' },
        response: { status: 403 },
      }),
    });
    const VerificationCaseDetailPage = await loadPage();

    await expect(
      VerificationCaseDetailPage({ params: Promise.resolve({ id: 'case-1' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('/verification/case-1')),
    );
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('reverify=1'));
  });

  it('throws on an unexpected failure instead of silently degrading', async () => {
    headersMock.mockResolvedValue(makeHeaders('/verification/case-1'));
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 500 } }),
    });
    const VerificationCaseDetailPage = await loadPage();

    await expect(
      VerificationCaseDetailPage({ params: Promise.resolve({ id: 'case-1' }) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('throws instead of rendering without a session', async () => {
    headersMock.mockResolvedValue(makeHeaders('/verification/case-1'));
    getSessionMock.mockResolvedValue(null);
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: caseDetail, response: { status: 200 } },
        { data: { items: [], nextCursor: null }, response: { status: 200 } },
      ),
    });
    const VerificationCaseDetailPage = await loadPage();

    await expect(
      VerificationCaseDetailPage({ params: Promise.resolve({ id: 'case-1' }) }),
    ).rejects.toThrow(/session/);
  });
});
