'use strict';

const BASE_URL = process.env.LHCI_BASE_URL || 'http://127.0.0.1:3000';

// The three public page shapes search engines and real visitors hit
// (docs/steps/1B.11-seo.md): the marketing home page, a published
// photographer profile and a published job offer. Slugs match
// packages/db/src/seed.ts (SEED_REQUEST_PHOTOGRAPHER_SLUG,
// SEED_JOB_OFFER_SLUG) the same way tests/smoke/pages.ts already does, so
// the same seed run backs both suites.
const PATHS = [
  '/en',
  '/en/photographers/sofia-martins',
  '/en/job-offers/event-photographer-luxembourg-city',
];

module.exports = { BASE_URL, PATHS, urls: PATHS.map((path) => `${BASE_URL}${path}`) };
