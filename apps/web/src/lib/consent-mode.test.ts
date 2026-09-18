import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_MODE_DEFAULT_SCRIPT, pushConsentUpdate } from './consent-mode';

describe('CONSENT_MODE_DEFAULT_SCRIPT', () => {
  it('denies all four Consent Mode v2 signals and waits for a real decision', () => {
    expect(CONSENT_MODE_DEFAULT_SCRIPT).toContain("ad_storage: 'denied'");
    expect(CONSENT_MODE_DEFAULT_SCRIPT).toContain("ad_user_data: 'denied'");
    expect(CONSENT_MODE_DEFAULT_SCRIPT).toContain("ad_personalization: 'denied'");
    expect(CONSENT_MODE_DEFAULT_SCRIPT).toContain("analytics_storage: 'denied'");
    expect(CONSENT_MODE_DEFAULT_SCRIPT).toContain('wait_for_update');
  });

  it('carries no personal data', () => {
    expect(CONSENT_MODE_DEFAULT_SCRIPT).not.toMatch(/@/);
    expect(CONSENT_MODE_DEFAULT_SCRIPT).not.toMatch(/anonymousId|userId|email/i);
  });
});

describe('pushConsentUpdate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing without a window (server-side)', () => {
    expect(() => {
      pushConsentUpdate({ analytics: true, adsMarketing: true });
    }).not.toThrow();
  });

  it('maps analytics/adsMarketing grants onto the four Consent Mode signals with no personal data', () => {
    const gtag = vi.fn();
    (window as typeof window & { gtag?: typeof gtag }).gtag = gtag;

    pushConsentUpdate({ analytics: true, adsMarketing: false });

    expect(gtag).toHaveBeenCalledWith('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    const [, , payload] = gtag.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(Object.keys(payload).sort()).toEqual(
      ['ad_personalization', 'ad_storage', 'ad_user_data', 'analytics_storage'].sort(),
    );

    delete (window as typeof window & { gtag?: typeof gtag }).gtag;
  });

  it('does not throw when no gtag stub has been installed yet', () => {
    delete (window as typeof window & { gtag?: unknown }).gtag;
    expect(() => {
      pushConsentUpdate({ analytics: false, adsMarketing: false });
    }).not.toThrow();
  });
});
