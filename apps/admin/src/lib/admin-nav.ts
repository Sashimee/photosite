import type { AdminPermission } from '@photoo/shared';

import type { TranslateFn } from './auth-errors';

interface NavBlock {
  kind: 'api' | 'ui';
  step: string;
}

interface AdminNavSection {
  id: string;
  href: string;
  labelKey: string;
  permission?: AdminPermission;
  blockedBy?: NavBlock;
}

export interface ResolvedNavSection {
  id: string;
  href: string;
  label: string;
  available: boolean;
  note?: string;
}

// `blockedBy.kind` distinguishes two different reasons a section has no
// page yet: 'api' means the backing endpoint genuinely doesn't exist (check
// apps/api/src/openapi/not-yet-implemented.ts before adding one of these),
// 'ui' means the endpoint is ready and only this app's page is pending.
// Conflating them would blame the API for a gap that is actually ours.
const ADMIN_NAV_SECTIONS: readonly AdminNavSection[] = [
  { id: 'dashboard', href: '/', labelKey: 'dashboard' },
  { id: 'health', href: '/health', labelKey: 'health' },
  { id: 'users', href: '/users', labelKey: 'users' },
  {
    id: 'verification',
    href: '/verification',
    labelKey: 'verification',
    permission: 'verification',
  },
  { id: 'provenance', href: '/provenance', labelKey: 'provenance', permission: 'moderation' },
  { id: 'finance', href: '/finance', labelKey: 'finance', permission: 'finance' },
  { id: 'moderation', href: '/moderation', labelKey: 'moderation', permission: 'moderation' },
  { id: 'data-requests', href: '/data-requests', labelKey: 'dataRequests', permission: 'support' },
  { id: 'settings', href: '/settings', labelKey: 'settings' },
];

export function resolveNavSections(t: TranslateFn): ResolvedNavSection[] {
  return ADMIN_NAV_SECTIONS.map((section) => {
    const label = t(`nav.${section.labelKey}`);
    if (!section.blockedBy) {
      return { id: section.id, href: section.href, label, available: true };
    }
    const note =
      section.blockedBy.kind === 'api'
        ? t('nav.availableAfter', { step: section.blockedBy.step })
        : t('nav.comingSoon', { step: section.blockedBy.step });
    return { id: section.id, href: section.href, label, available: false, note };
  });
}

export function canOpenSection(id: string, permissions: readonly AdminPermission[]): boolean {
  const section = ADMIN_NAV_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) {
    throw new Error(`Unknown admin nav section: ${id}`);
  }
  return !section.permission || permissions.includes(section.permission);
}
