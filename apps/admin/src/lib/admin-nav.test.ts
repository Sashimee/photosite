import { describe, expect, it, vi } from 'vitest';

import { resolveNavSections } from './admin-nav';

function fakeT() {
  return vi.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  );
}

describe('resolveNavSections', () => {
  it('marks the dashboard, health, users and verification sections as available with no note', () => {
    const sections = resolveNavSections(fakeT());

    const dashboard = sections.find((section) => section.id === 'dashboard');
    const health = sections.find((section) => section.id === 'health');
    const users = sections.find((section) => section.id === 'users');
    const verification = sections.find((section) => section.id === 'verification');
    const moderation = sections.find((section) => section.id === 'moderation');
    const dataRequests = sections.find((section) => section.id === 'data-requests');
    const settings = sections.find((section) => section.id === 'settings');

    expect(dashboard).toMatchObject({ href: '/', label: 'nav.dashboard', available: true });
    expect(dashboard?.note).toBeUndefined();
    expect(health).toMatchObject({ href: '/health', label: 'nav.health', available: true });
    expect(health?.note).toBeUndefined();
    expect(users).toMatchObject({ href: '/users', label: 'nav.users', available: true });
    expect(users?.note).toBeUndefined();
    expect(verification).toMatchObject({
      href: '/verification',
      label: 'nav.verification',
      available: true,
    });
    expect(verification?.note).toBeUndefined();
    expect(moderation).toMatchObject({
      href: '/moderation',
      label: 'nav.moderation',
      available: true,
    });
    expect(moderation?.note).toBeUndefined();
    expect(dataRequests).toMatchObject({
      href: '/data-requests',
      label: 'nav.dataRequests',
      available: true,
    });
    expect(dataRequests?.note).toBeUndefined();
    expect(settings).toMatchObject({
      href: '/settings',
      label: 'nav.settings',
      available: true,
    });
    expect(settings?.note).toBeUndefined();
  });

  it('labels a section blocked on a missing endpoint as available after that step', () => {
    const sections = resolveNavSections(fakeT());

    const provenance = sections.find((section) => section.id === 'provenance');

    expect(provenance?.available).toBe(false);
    expect(provenance?.note).toBe('nav.availableAfter:{"step":"1A.10"}');
  });

  it('resolves every section exactly once, in a stable order', () => {
    const sections = resolveNavSections(fakeT());

    expect(sections.map((section) => section.id)).toEqual([
      'dashboard',
      'health',
      'users',
      'verification',
      'provenance',
      'finance',
      'moderation',
      'data-requests',
      'settings',
    ]);
  });
});
