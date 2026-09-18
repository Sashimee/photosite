import { describe, expect, it } from 'vitest';

import {
  buildDecision,
  decodeConsentCookieValue,
  encodeConsentCookieValue,
  isAnalyticsCookieName,
  isPolicyVersionNewer,
  needsReprompt,
} from './consent';

describe('buildDecision', () => {
  it('stamps the categories with the given policy version and the current time', () => {
    const before = Date.now();
    const decision = buildDecision({ analytics: true, adsMarketing: false }, '3');
    const after = Date.now();

    expect(decision.policyVersion).toBe('3');
    expect(decision.categories).toEqual({ analytics: true, adsMarketing: false });
    const decidedAt = new Date(decision.decidedAt).getTime();
    expect(decidedAt).toBeGreaterThanOrEqual(before);
    expect(decidedAt).toBeLessThanOrEqual(after);
  });
});

describe('encodeConsentCookieValue / decodeConsentCookieValue', () => {
  it('round-trips a decision', () => {
    const decision = buildDecision({ analytics: true, adsMarketing: true }, '2');
    const decoded = decodeConsentCookieValue(encodeConsentCookieValue(decision));
    expect(decoded).toEqual(decision);
  });

  it('returns null for a missing cookie value', () => {
    expect(decodeConsentCookieValue(undefined)).toBeNull();
    expect(decodeConsentCookieValue(null)).toBeNull();
    expect(decodeConsentCookieValue('')).toBeNull();
  });

  it('returns null instead of throwing for garbage input', () => {
    expect(decodeConsentCookieValue('not-json-at-all')).toBeNull();
    expect(decodeConsentCookieValue(encodeURIComponent('{"foo":"bar"}'))).toBeNull();
    expect(
      decodeConsentCookieValue(encodeURIComponent(JSON.stringify({ policyVersion: 1 }))),
    ).toBeNull();
  });

  it('rejects a cookie carrying an identifier instead of just the decision', () => {
    const tampered = encodeURIComponent(
      JSON.stringify({
        policyVersion: '1',
        decidedAt: new Date().toISOString(),
        categories: { analytics: true, adsMarketing: true },
        anonymousId: 'should-not-be-here',
      }),
    );
    expect(decodeConsentCookieValue(tampered)).toBeNull();
  });
});

describe('isPolicyVersionNewer', () => {
  it('treats a higher integer as newer', () => {
    expect(isPolicyVersionNewer('2', '1')).toBe(true);
    expect(isPolicyVersionNewer('1', '2')).toBe(false);
    expect(isPolicyVersionNewer('1', '1')).toBe(false);
  });

  it('treats an unpublished (null) current version as never newer', () => {
    expect(isPolicyVersionNewer(null, '1')).toBe(false);
    expect(isPolicyVersionNewer(null, null)).toBe(false);
  });

  it('treats any published version as newer than a decision made with none', () => {
    expect(isPolicyVersionNewer('1', null)).toBe(true);
  });
});

describe('needsReprompt', () => {
  it('is true when there is no stored decision', () => {
    expect(needsReprompt(null, '1')).toBe(true);
    expect(needsReprompt(null, null)).toBe(true);
  });

  it('is false when the stored decision matches the current version', () => {
    const decision = buildDecision({ analytics: false, adsMarketing: false }, '1');
    expect(needsReprompt(decision, '1')).toBe(false);
  });

  it('is true once a newer policy version is published', () => {
    const decision = buildDecision({ analytics: false, adsMarketing: false }, '1');
    expect(needsReprompt(decision, '2')).toBe(true);
  });

  it('does not re-prompt merely because the published version is still unset', () => {
    const decision = buildDecision({ analytics: true, adsMarketing: true }, null);
    expect(needsReprompt(decision, null)).toBe(false);
  });
});

describe('isAnalyticsCookieName', () => {
  it('matches GA4 cookie names', () => {
    expect(isAnalyticsCookieName('_ga')).toBe(true);
    expect(isAnalyticsCookieName('_gid')).toBe(true);
    expect(isAnalyticsCookieName('_ga_ABCDE12345')).toBe(true);
  });

  it('does not match unrelated cookies', () => {
    expect(isAnalyticsCookieName('photoo_consent')).toBe(false);
    expect(isAnalyticsCookieName('photoo_session')).toBe(false);
  });
});
