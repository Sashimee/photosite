import {
  EMAIL_TEMPLATE_NAMES as SHARED_EMAIL_TEMPLATE_NAMES,
  SUPPORTED_LOCALES,
} from '@photoo/shared';
import { describe, expect, it } from 'vitest';
import {
  AUTH_EMAIL_TEMPLATE_NAMES,
  EMAIL_TEMPLATE_NAMES,
  NOTIFY_EMAIL_TEMPLATE_NAMES,
  renderPreview,
} from './preview.js';

const UNRESOLVED_PLACEHOLDER = /\{[a-zA-Z]+\}/;

describe('EMAIL_TEMPLATE_NAMES', () => {
  it('excludes message_received, which has no email channel', () => {
    expect(NOTIFY_EMAIL_TEMPLATE_NAMES).not.toContain('message_received');
  });

  it('combines the auth and notify template names with no overlap', () => {
    const authSet = new Set<string>(AUTH_EMAIL_TEMPLATE_NAMES);
    const overlap = NOTIFY_EMAIL_TEMPLATE_NAMES.filter((name) => authSet.has(name));
    expect(overlap).toEqual([]);
    expect(EMAIL_TEMPLATE_NAMES).toHaveLength(
      AUTH_EMAIL_TEMPLATE_NAMES.length + NOTIFY_EMAIL_TEMPLATE_NAMES.length,
    );
  });

  // @photoo/shared can't import @photoo/email (the dependency runs the other
  // way), so it keeps its own copy of AUTH_EMAIL_TEMPLATE_NAMES by hand.
  it('matches the copy kept in @photoo/shared for contract validation', () => {
    expect([...SHARED_EMAIL_TEMPLATE_NAMES]).toEqual([...EMAIL_TEMPLATE_NAMES]);
  });
});

describe('renderPreview', () => {
  for (const template of EMAIL_TEMPLATE_NAMES) {
    for (const locale of SUPPORTED_LOCALES) {
      it(`renders "${template}" in "${locale}" with every placeholder resolved`, () => {
        const preview = renderPreview(template, locale);

        expect(preview.subject).not.toMatch(UNRESOLVED_PLACEHOLDER);
        expect(preview.html).not.toMatch(UNRESOLVED_PLACEHOLDER);
        expect(preview.text).not.toMatch(UNRESOLVED_PLACEHOLDER);
        expect(preview.subject.length).toBeGreaterThan(0);
        expect(preview.html.length).toBeGreaterThan(0);
        expect(preview.text.length).toBeGreaterThan(0);
      });
    }
  }
});
