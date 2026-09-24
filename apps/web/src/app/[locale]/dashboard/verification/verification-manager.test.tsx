import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock, POST: postMock, PATCH: patchMock } }));

type VerificationCase = components['schemas']['VerificationCase'];
type RequiredDocument = components['schemas']['RequiredDocument'];

const requirements: RequiredDocument[] = [
  {
    key: 'id_card',
    label: { en: 'Government ID' },
    description: null,
    acceptedMimeTypes: ['application/pdf'],
  },
];

function verificationCase(overrides: Partial<VerificationCase> = {}): VerificationCase {
  return {
    id: 'case-1',
    countryCode: 'LU',
    status: 'draft',
    documents: [],
    submittedAt: null,
    decidedAt: null,
    rejectionReason: null,
    businessName: null,
    vatNumber: null,
    businessRegistrationNumber: null,
    ...overrides,
  };
}

async function loadManager() {
  const { VerificationManager } = await import('./verification-manager');
  return VerificationManager;
}

describe('VerificationManager', () => {
  afterEach(() => {
    vi.resetModules();
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
  });

  it('shows a notice and no document uploads when there is no case yet', async () => {
    const VerificationManager = await loadManager();
    render(<VerificationManager locale="en" requirements={requirements} initialCase={null} />);

    expect(
      screen.getByText(translate('web.dashboard.verification', 'documentsNeedCaseNotice')),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start verification' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  it('creates a case from the business details form', async () => {
    postMock.mockResolvedValue({
      data: verificationCase({ businessName: 'Acme Photography' }),
      error: undefined,
    });
    const VerificationManager = await loadManager();
    const user = userEvent.setup();

    render(<VerificationManager locale="en" requirements={requirements} initialCase={null} />);

    await user.type(screen.getByLabelText('Business name'), 'Acme Photography');
    await user.click(screen.getByRole('button', { name: 'Start verification' }));

    expect(postMock).toHaveBeenCalledWith('/v1/me/verification-case', {
      body: { businessName: 'Acme Photography' },
    });
    expect(
      await screen.findByText(translate('web.dashboard.verification', 'caseStarted')),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('saves details on a draft case with PATCH, not POST', async () => {
    patchMock.mockResolvedValue({
      data: verificationCase({ businessName: 'Acme Photography', vatNumber: 'LU123' }),
      error: undefined,
    });
    const VerificationManager = await loadManager();
    const user = userEvent.setup();

    render(
      <VerificationManager
        locale="en"
        requirements={requirements}
        initialCase={verificationCase({ businessName: 'Acme' })}
      />,
    );

    await user.clear(screen.getByLabelText('Business name'));
    await user.type(screen.getByLabelText('Business name'), 'Acme Photography');
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    expect(patchMock).toHaveBeenCalledWith('/v1/me/verification-case', {
      body: { businessName: 'Acme Photography' },
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('does not render an editable form or an upload action once the case is submitted', async () => {
    const VerificationManager = await loadManager();
    render(
      <VerificationManager
        locale="en"
        requirements={requirements}
        initialCase={verificationCase({
          status: 'submitted',
          businessName: 'Acme',
          submittedAt: '2026-01-02T10:00:00.000Z',
        })}
      />,
    );

    expect(screen.queryByLabelText('Business name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument();
    expect(screen.getByText('Submitted, waiting for review')).toBeInTheDocument();
  });

  it('shows the rejection reason and a way to start a new case when rejected, but no edit form', async () => {
    const VerificationManager = await loadManager();
    render(
      <VerificationManager
        locale="en"
        requirements={requirements}
        initialCase={verificationCase({
          status: 'rejected',
          businessName: 'Acme',
          rejectionReason: 'The ID photo was blurry.',
        })}
      />,
    );

    expect(screen.getByText('The ID photo was blurry.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Business name')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start a new verification case' }),
    ).toBeInTheDocument();
  });

  it('does not offer to start a new case once verified', async () => {
    const VerificationManager = await loadManager();
    render(
      <VerificationManager
        locale="en"
        requirements={requirements}
        initialCase={verificationCase({ status: 'approved', businessName: 'Acme' })}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Start a new verification case' }),
    ).not.toBeInTheDocument();
  });

  it('starts a fresh draft case after confirming, replacing the rejected one', async () => {
    postMock.mockResolvedValue({ data: verificationCase({ status: 'draft' }), error: undefined });
    const VerificationManager = await loadManager();
    const user = userEvent.setup();

    render(
      <VerificationManager
        locale="en"
        requirements={requirements}
        initialCase={verificationCase({
          status: 'rejected',
          businessName: 'Acme',
          rejectionReason: 'Blurry photo.',
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start a new verification case' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Yes, start again' }));

    expect(postMock).toHaveBeenCalledWith('/v1/me/verification-case', { body: {} });
    expect(await screen.findByLabelText('Business name')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('disables submitting until a business name and every required document are attached', async () => {
    const VerificationManager = await loadManager();
    render(
      <VerificationManager
        locale="en"
        requirements={requirements}
        initialCase={verificationCase({ businessName: null })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    expect(
      screen.getByText(translate('web.dashboard.verification', 'submitRequirementsHint')),
    ).toBeInTheDocument();
  });

  it('submits for review once every requirement is met, after confirming', async () => {
    postMock.mockResolvedValue({
      data: verificationCase({ status: 'submitted', businessName: 'Acme' }),
      error: undefined,
    });
    const VerificationManager = await loadManager();
    const user = userEvent.setup();

    render(
      <VerificationManager
        locale="en"
        requirements={requirements}
        initialCase={verificationCase({
          businessName: 'Acme',
          documents: [
            {
              id: 'doc-1',
              documentKey: 'id_card',
              mimeType: 'application/pdf',
              virusScanStatus: 'clean',
              uploadedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        })}
      />,
    );

    const submitCta = screen.getByRole('button', { name: 'Submit for review' });
    expect(submitCta).toBeEnabled();
    await user.click(submitCta);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Yes, submit' }));

    expect(postMock).toHaveBeenCalledWith('/v1/me/verification-case/submit');
    expect(await screen.findByText('Submitted, waiting for review')).toBeInTheDocument();
  });

  it('maps a conflict from saving details to the translated message', async () => {
    postMock.mockResolvedValue({ data: undefined, error: { code: 'CONFLICT' } });
    const VerificationManager = await loadManager();
    const user = userEvent.setup();

    render(<VerificationManager locale="en" requirements={requirements} initialCase={null} />);

    await user.type(screen.getByLabelText('Business name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Start verification' }));

    expect(
      await screen.findByText(translate('web.dashboard.verification', 'errors.conflict')),
    ).toBeInTheDocument();
  });
});
