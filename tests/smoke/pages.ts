import { SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

// packages/db/src/seed.ts: SEED_PHOTOGRAPHER_PROFILES[0], the one demo
// profile guaranteed to exist, be published and be verified.
export const SEED_PHOTOGRAPHER_SLUG = 'sofia-martins';

// packages/db/src/seed.ts: SEED_USERS[0] / SEED_REQUEST_CLIENT_EMAIL - the
// only seeded user with a request, a quote and a conversation already
// attached, so the signed-in pages below have real data to render.
export const SEED_CLIENT_EMAIL = 'client@photoo.test';

export const SIGNED_IN_LOCALE: Locale = 'en';

// The seed hashes this with Argon2id before storing it (never plaintext),
// and it is never a real credential, but it still isn't ours to spell out
// in test source - read it the same way packages/db/src/seed.ts does.
export function seedUserPassword(): string {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) {
    throw new Error(
      'SEED_USER_PASSWORD is not set. The smoke suite signs in as the seeded client ' +
        '(packages/db/src/seed.ts getSeedUserPassword()) and needs the same value the ' +
        'seed run used - export it before `pnpm test:smoke` (see packages/db/.env.example).',
    );
  }
  return password;
}

export interface SmokePage {
  readonly path: string;
  readonly reason: string;
}

interface SignedOutRoute {
  readonly path: string;
  readonly reason: string;
}

const SIGNED_OUT_ROUTES: readonly SignedOutRoute[] = [
  { path: '/', reason: 'the marketing home page - first thing every visitor and crawler hits' },
  {
    path: '/photographers',
    reason: 'the search/listing page - the main discovery surface, data-driven from the API',
  },
  {
    path: `/photographers/${SEED_PHOTOGRAPHER_SLUG}`,
    reason:
      "a real published photographer profile - exercises the profile page's server-side data fetch, images and JSON-LD",
  },
  {
    path: '/sign-in',
    reason: 'entry point for every authenticated flow, including this suite’s own setup',
  },
  {
    path: '/legal/imprint',
    reason: 'legally required page, linked from the footer on every page',
  },
  {
    path: '/legal/privacy',
    reason: 'legally required page, linked from the footer on every page',
  },
  {
    path: '/consent',
    reason:
      'the consent settings page - reachable from the footer, has to render (and its form submit) without JavaScript',
  },
];

export const SIGNED_OUT_PAGES: readonly SmokePage[] = SUPPORTED_LOCALES.flatMap((locale) =>
  SIGNED_OUT_ROUTES.map(({ path, reason }) => ({
    path: path === '/' ? `/${locale}` : `/${locale}${path}`,
    reason: `[${locale}] ${reason}`,
  })),
);

export const SIGNED_IN_PAGES: readonly SmokePage[] = [
  {
    path: `/${SIGNED_IN_LOCALE}/requests`,
    reason: "the client's request list - needs a real session and reads /v1/requests/mine",
  },
  {
    path: `/${SIGNED_IN_LOCALE}/quotes`,
    reason: "the client's quote list",
  },
  {
    path: `/${SIGNED_IN_LOCALE}/messages`,
    reason: 'the chat inbox, backed by Socket.IO',
  },
  {
    path: `/${SIGNED_IN_LOCALE}/account`,
    reason: 'the page every sign-in lands on - reads the session cookie server-side',
  },
];
