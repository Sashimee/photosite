import { randomUUID } from 'node:crypto';

import { createApiClient } from '@photoo/api-client';
import { SIGNUP_ROLES } from '@photoo/shared';

import { waitForLinkInEmail } from '../support/mailpit.js';

export type SignUpRole = (typeof SIGNUP_ROLES)[number];

export interface VerifiedUser {
  email: string;
  password: string;
}

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set - createVerifiedUser signs up over HTTP against the ' +
        'running API and needs it (see apps/web/.env.example, or the e2e CI job env).',
    );
  }
  return url;
}

function extractVerificationToken(link: string): string {
  const marker = '#token=';
  const markerIndex = link.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`createVerifiedUser: verification link had no "${marker}" fragment: ${link}`);
  }
  return decodeURIComponent(link.slice(markerIndex + marker.length));
}

// Fresh identity per call, via API + Mailpit rather than a seeded row
// (docs/steps/1B.12-web-e2e.md "Decisions for this step"): nothing here
// needs an already-published, admin-gated state, so a throwaway sign-up is
// cheaper and more honest than reusing a seeded user across runs.
export async function createVerifiedUser(role: SignUpRole): Promise<VerifiedUser> {
  const api = createApiClient({ baseUrl: apiBaseUrl() });
  const email = `e2e-${role}-${randomUUID()}@photoo.test`;
  const password = `e2e-${randomUUID()}`;

  const signUp = await api.POST('/v1/auth/sign-up', {
    body: { email, password, roles: [role], locale: 'en' },
  });
  if (signUp.error) {
    throw new Error(
      `createVerifiedUser: sign-up for ${email} (role ${role}) failed: ${JSON.stringify(signUp.error)}`,
    );
  }

  const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
  const token = extractVerificationToken(link);

  const verify = await api.POST('/v1/auth/verify-email', { body: { token } });
  if (verify.error) {
    throw new Error(
      `createVerifiedUser: verify-email for ${email} failed: ${JSON.stringify(verify.error)}`,
    );
  }

  return { email, password };
}
