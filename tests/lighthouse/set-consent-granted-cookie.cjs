'use strict';

// LHCI launches its own puppeteer-controlled Chrome and hands that same
// browser's CDP port to Lighthouse for the actual audit (see
// PuppeteerManager#getBrowserPort in @lhci/cli), so a cookie set here is
// still present for the run that follows.
//
// Same cookie shape as encodeConsentCookieValue()/CONSENT_COOKIE_NAME in
// apps/web/src/lib/consent.ts, duplicated rather than imported: that module
// is TypeScript/ESM and this script runs as plain CommonJS under Node
// directly (no build step). `secure` is deliberately omitted - the real
// cookie writer always sets it, but this suite measures over plain HTTP
// (both locally and in CI), and Chrome silently refuses to store a Secure
// cookie on a non-HTTPS origin.
const CONSENT_COOKIE_NAME = 'photoo_consent';

/**
 * @param {import('puppeteer-core').Browser} browser
 * @param {{url: string}} context
 */
module.exports = async function setConsentGrantedCookie(browser, { url }) {
  const origin = new URL(url).origin;
  const page = await browser.newPage();
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const decision = {
      policyVersion: null,
      decidedAt: new Date().toISOString(),
      categories: { analytics: true, adsMarketing: true },
    };
    await page.setCookie({
      name: CONSENT_COOKIE_NAME,
      value: encodeURIComponent(JSON.stringify(decision)),
      url: origin,
      path: '/',
      sameSite: 'Lax',
    });
  } finally {
    await page.close();
  }
};
