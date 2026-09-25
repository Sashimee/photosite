import type { TranslateFn } from './auth-errors';

interface NavBlock {
  kind: 'api' | 'ui';
  step: string;
}

interface AdminNavSection {
  id: string;
  href: string;
  labelKey: string;
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
  { id: 'verification', href: '/verification', labelKey: 'verification' },
  {
    id: 'provenance',
    href: '/provenance',
    labelKey: 'provenance',
    blockedBy: { kind: 'api', step: '1A.10' },
  },
  {
    id: 'finance',
    href: '/finance',
    labelKey: 'finance',
    blockedBy: { kind: 'api', step: '1A.8' },
  },
  { id: 'moderation', href: '/moderation', labelKey: 'moderation' },
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
