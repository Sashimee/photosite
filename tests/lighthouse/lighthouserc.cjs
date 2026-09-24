'use strict';

const { urls } = require('./urls.cjs');

// Consent denied is the default first-visit state (lib/consent-mode.ts sets
// every Consent Mode v2 signal to 'denied' before any tag can load, and a
// fresh Chrome profile - what `lhci collect` launches - has no
// `photoo_consent` cookie), so this config needs no puppeteerScript: doing
// nothing *is* measuring denied.
//
// `numberOfRuns` and the assertion step both live outside `lhci`'s own
// `assert` command (see assert-budgets.cjs) because this @lhci/cli version
// has no per-URL assertion budgets, and the three pages have deliberately
// different byte-weight ceilings (budgets.cjs).
module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: Number(process.env.LHCI_NUMBER_OF_RUNS || 5),
      chromePath: process.env.CHROME_PATH || undefined,
      settings: {
        chromeFlags: '--no-sandbox --disable-gpu',
        onlyCategories: ['performance'],
        throttlingMethod: 'simulate',
      },
    },
  },
};
