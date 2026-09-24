'use strict';

// Budgets are set from a measured baseline, not aspirational targets
// (docs/steps/1B.11-seo.md "a budget nobody can meet gets disabled within a
// week"): three independent 5-run trials (15 Lighthouse runs per page) of
// `lhci collect` against this build, consent denied, on an idle 6-core
// machine (see the PR body for the full numbers). Even uncontended, the
// *representative* run @lhci/utils picks per trial (closest to median FCP +
// TTI, not literally median LCP - see read-results.cjs) swung this much:
//
//   page      representative LCP across 3 trials (ms)   total-byte-weight (kB)
//   home                    2456 / 2457 / 3216                    454-456
//   profile                 2166 / 2524 / 3675                    459-460
//   job offer               2571 / 3097 / 3453                    474-476
//
// A GitHub-hosted runner (#201's shared, CPU-contended 2-vCPU box) should be
// assumed at least as noisy as that idle 6-core one, so each LCP budget is
// the highest of its three trials plus ~40% headroom, rounded. Byte weight
// barely moved across all 45 runs, so it keeps a smaller (~50%) margin over
// its own observed max - room for real content growth, not noise. CLS was
// exactly 0 throughout (no GTM container ships until 2.6, and every image
// on these pages is already sized), so its budget is simply the standard
// "good" Core Web Vitals threshold rather than the measured 0 - the point is
// to catch a future regression (e.g. an injected ad slot), not to freeze at
// today's best case.
//
// Byte weight is budgeted per page on purpose (`lhci assert`'s single
// global assertion set can't express this in the pinned @lhci/cli version):
// a shared ceiling sized for the heaviest page would hide a real regression
// on a lighter one.
const BUDGETS = {
  '/en': {
    label: 'home',
    largestContentfulPaintMs: 4500,
    cumulativeLayoutShift: 0.1,
    totalByteWeightBytes: 700_000,
  },
  '/en/photographers/sofia-martins': {
    label: 'photographer profile',
    largestContentfulPaintMs: 5200,
    cumulativeLayoutShift: 0.1,
    totalByteWeightBytes: 750_000,
  },
  '/en/job-offers/event-photographer-luxembourg-city': {
    label: 'job offer',
    largestContentfulPaintMs: 4800,
    cumulativeLayoutShift: 0.1,
    totalByteWeightBytes: 700_000,
  },
};

module.exports = { BUDGETS };
