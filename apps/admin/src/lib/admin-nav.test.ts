import { describe, expect, it, vi } from 'vitest';

import { resolveNavSections } from './admin-nav';

function fakeT() {
  return vi.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  );
}

describe('resolveNavSections', () => {
  it('marks the dashboard and health sections as available with no note', () => {
    const sections = resolveNavSections(fakeT());

    const dashboard = sections.find((section) => section.id === 'dashboard');
    const health = sections.find((section) => section.id === 'health');

    expect(dashboard).toMatchObject({ href: '/', label: 'nav.dashboard', available: true });
    expect(dashboard?.note).toBeUndefined();
    expect(health).toMatchObject({ href: '/health', label: 'nav.health', available: true });
    expect(health?.note).toBeUndefined();
  });

  it('labels a section blocked on our own UI work as coming soon, not API-unavailable', () => {
    const sections = resolveNavSections(fakeT());

    const users = sections.find((section) => section.id === 'users');

    expect(users?.available).toBe(false);
    expect(users?.note).toBe('nav.comingSoon:{"step":"1D.2"}');
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
      'settings',
    ]);
  });
});
