import { describe, expect, it, vi } from 'vitest';

import type { AdminPermission } from '@photoo/shared';

import { canOpenSection, resolveNavSections } from './admin-nav';

function fakeT() {
  return vi.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  );
}

describe('resolveNavSections', () => {
  it('marks the dashboard, health, users, verification, provenance and finance sections as available with no note', () => {
    const sections = resolveNavSections(fakeT());

    const dashboard = sections.find((section) => section.id === 'dashboard');
    const health = sections.find((section) => section.id === 'health');
    const users = sections.find((section) => section.id === 'users');
    const verification = sections.find((section) => section.id === 'verification');
    const provenance = sections.find((section) => section.id === 'provenance');
    const finance = sections.find((section) => section.id === 'finance');
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
    expect(provenance).toMatchObject({
      href: '/provenance',
      label: 'nav.provenance',
      available: true,
    });
    expect(provenance?.note).toBeUndefined();
    expect(finance).toMatchObject({ href: '/finance', label: 'nav.finance', available: true });
    expect(finance?.note).toBeUndefined();
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

describe('canOpenSection', () => {
  it.each([
    ['verification', 'verification'],
    ['provenance', 'moderation'],
    ['moderation', 'moderation'],
    ['data-requests', 'support'],
    ['finance', 'finance'],
  ] as const)('opens %s only with the %s permission', (id, permission) => {
    const others = (['verification', 'moderation', 'support', 'finance'] as const).filter(
      (candidate) => candidate !== permission,
    );

    expect(canOpenSection(id, [permission])).toBe(true);
    expect(canOpenSection(id, [])).toBe(false);
    expect(canOpenSection(id, others)).toBe(false);
  });

  it.each(['dashboard', 'health', 'users', 'settings'])(
    'opens %s with no permission at all',
    (id) => {
      expect(canOpenSection(id, [])).toBe(true);
    },
  );

  it('does not treat superadmin as a grant for another section', () => {
    const permissions: AdminPermission[] = ['superadmin'];

    expect(canOpenSection('verification', permissions)).toBe(false);
  });

  it('throws on an unknown section id instead of defaulting to open', () => {
    expect(() => canOpenSection('nope', ['finance'])).toThrow(/Unknown admin nav section: nope/);
  });
});
