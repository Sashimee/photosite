import { OAUTH_PROVIDERS } from '@photoo/shared';
import type { Env } from '../../config/env.js';

export function isOAuthProvider(value: string): value is (typeof OAUTH_PROVIDERS)[number] {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export function isProviderConfigured(provider: string, config: Env): boolean {
  switch (provider) {
    case 'google':
      return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
    case 'apple':
      return Boolean(config.APPLE_CLIENT_ID && config.APPLE_CLIENT_SECRET);
    case 'facebook':
      return Boolean(config.FACEBOOK_CLIENT_ID && config.FACEBOOK_CLIENT_SECRET);
    case 'microsoft':
      return Boolean(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET);
    default:
      return false;
  }
}
