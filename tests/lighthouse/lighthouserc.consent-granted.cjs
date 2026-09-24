'use strict';

const { urls } = require('./urls.cjs');

// Reporting only, never a gate (docs/steps/1B.11-seo.md "separately reported
// with it granted"): report-consent-granted.mjs prints the same three
// metrics for a visitor who already accepted analytics/ads, so a future
// GTM container (2.6) shows up here as a number to watch rather than as a
// surprise failure on the denied-by-default budget in lighthouserc.cjs.
// No GTM container is wired up yet (1B.10's Consent Mode v2 defaults have
// nothing to grant into), so today this run is expected to look like the
// denied one - that will stop being true the moment 2.6 loads a real tag.
module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: Number(process.env.LHCI_NUMBER_OF_RUNS || 5),
      // @lhci/cli resolves this relative to `process.cwd()`, not this file
      // (PuppeteerManager#invokePuppeteerScriptForUrl does
      // `path.join(process.cwd(), scriptPath)`), so it only works run from
      // the repo root - which is how the `test:lighthouse*` scripts and CI
      // both invoke it.
      puppeteerScript: 'tests/lighthouse/set-consent-granted-cookie.cjs',
      // `puppeteerScript` launches its own browser via `puppeteer-core`, and
      // that launch ignores `settings.chromeFlags` (a `lhci collect`
      // warning says so): the args have to go through
      // `puppeteerLaunchOptions.args` instead, or the CI/sandbox
      // no-usable-sandbox crash below never gets `--no-sandbox`.
      chromePath: process.env.CHROME_PATH || undefined,
      puppeteerLaunchOptions: {
        executablePath: process.env.CHROME_PATH || undefined,
        args: ['--no-sandbox', '--disable-gpu'],
      },
      settings: {
        onlyCategories: ['performance'],
        throttlingMethod: 'simulate',
      },
    },
  },
};
