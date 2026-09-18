import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api: { GET: vi.fn(), POST: vi.fn() } }));

import type { components } from '@photoo/api-client';

import { CaseActions } from './case-actions';

type AdminVerificationCase = components['schemas']['AdminVerificationCase'];

const baseCase: AdminVerificationCase = {
  id: 'case-1',
  countryCode: 'LU',
  status: 'submitted',
  documents: [],
  submittedAt: '2026-09-01T00:00:00.000Z',
  decidedAt: null,
  rejectionReason: null,
  businessName: null,
  vatNumber: null,
  businessRegistrationNumber: null,
  userId: 'user-1',
  assignedAdminId: null,
  decidedByAdminId: null,
};

describe('CaseActions', () => {
  it('shows only the claim panel for a submitted, unclaimed case', () => {
    render(<CaseActions caseDetail={baseCase} currentAdminId="admin-1" />);

    expect(screen.getByRole('button', { name: 'Start review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('shows approve and reject once the case is in review', () => {
    render(
      <CaseActions
        caseDetail={{ ...baseCase, status: 'in_review', assignedAdminId: 'admin-1' }}
        currentAdminId="admin-1"
      />,
    );

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('shows neither the claim panel nor decision buttons for a decided case', () => {
    render(
      <CaseActions
        caseDetail={{ ...baseCase, status: 'approved', assignedAdminId: 'admin-1' }}
        currentAdminId="admin-1"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Start review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
