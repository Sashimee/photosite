import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

const serverApiMock = vi.fn();

vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));
vi.mock('next-intl/server', async () => {
  const { mockUseFormatter, translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
    getFormatter: () => mockUseFormatter(),
  };
});

async function loadLastChanged() {
  const mod = await import('./last-changed');
  return mod.LastChanged;
}

type AdminAuditLogEntry = components['schemas']['AdminAuditLogEntry'];

function entry(overrides: Partial<AdminAuditLogEntry> = {}): AdminAuditLogEntry {
  return {
    id: 'audit-1',
    actorId: 'admin-1',
    action: 'PlatformSetting.updated',
    targetType: 'PlatformSetting',
    targetId: null,
    ip: null,
    occurredAt: '2026-01-15T10:30:00.000Z',
    ...overrides,
  };
}

describe('LastChanged', () => {
  it('renders the actor and time from the newest audit entry', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({
      data: { items: [entry({ actorId: 'admin-42', occurredAt: '2026-02-01T09:00:00.000Z' })] },
      response: { status: 200 },
    });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const LastChanged = await loadLastChanged();

    render(await LastChanged({ entityType: 'PlatformSetting' }));

    expect(screen.getByText('By admin-42 on Feb 1, 2026, 10:00 AM GMT+1')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/v1/admin/audit-log', {
      params: { query: { entityType: 'PlatformSetting', limit: 1 } },
    });
  });

  it('includes targetId in the query when provided', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({
      data: { items: [] },
      response: { status: 200 },
    });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const LastChanged = await loadLastChanged();

    render(await LastChanged({ entityType: 'Country', targetId: 'LU' }));

    expect(getMock).toHaveBeenCalledWith('/v1/admin/audit-log', {
      params: { query: { entityType: 'Country', targetId: 'LU', limit: 1 } },
    });
  });

  it('renders a system-initiated change without an actor id', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({
      data: { items: [entry({ actorId: null, occurredAt: '2026-03-05T00:00:00.000Z' })] },
      response: { status: 200 },
    });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const LastChanged = await loadLastChanged();

    render(await LastChanged({ entityType: 'PlatformSetting' }));

    expect(screen.getByText('By the system on Mar 5, 2026, 1:00 AM GMT+1')).toBeInTheDocument();
  });

  it('renders the never-changed state for an empty audit log', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({
      data: { items: [] },
      response: { status: 200 },
    });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const LastChanged = await loadLastChanged();

    render(await LastChanged({ entityType: 'PlatformSetting' }));

    expect(screen.getByText('No changes recorded yet.')).toBeInTheDocument();
  });

  it('throws on an unexpected load failure', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 500 } });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const LastChanged = await loadLastChanged();

    await expect(LastChanged({ entityType: 'PlatformSetting' })).rejects.toThrow(/HTTP 500/);
  });

  it('includes the targetId in the thrown error message when provided', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 500 } });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const LastChanged = await loadLastChanged();

    await expect(LastChanged({ entityType: 'Country', targetId: 'LU' })).rejects.toThrow(
      /Country\/LU: HTTP 500/,
    );
  });
});
