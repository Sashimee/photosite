import type { ConsentCategoryGrants } from './consent';

// Consent Mode v2 defaults, set in the document head before any tag can load
// (docs/steps/1B.10-consent.md). All four signals start denied and
// `wait_for_update` holds tag firing briefly for a real decision instead of
// assuming one. No GTM container loads in 1B.10a; this only seeds
// `dataLayer` so 1B.10b's container reads the right state the moment it
// loads, and so this file's own `update` calls have a `gtag` to call.
export const CONSENT_MODE_DEFAULT_SCRIPT = `window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500
});`;

type Gtag = (...args: unknown[]) => void;

export function pushConsentUpdate(categories: ConsentCategoryGrants): void {
  if (typeof window === 'undefined') {
    return;
  }
  const gtag = (window as typeof window & { gtag?: Gtag }).gtag;
  gtag?.('consent', 'update', {
    analytics_storage: categories.analytics ? 'granted' : 'denied',
    ad_storage: categories.adsMarketing ? 'granted' : 'denied',
    ad_user_data: categories.adsMarketing ? 'granted' : 'denied',
    ad_personalization: categories.adsMarketing ? 'granted' : 'denied',
  });
}
