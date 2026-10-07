# Store privacy declarations (1C.9b)

Answer sheet for the App Store privacy labels and the Google Play data-safety form, plus the iOS privacy manifest. Drafted from the code as of 2026-10-07; re-check against the code before every submission and whenever an SDK is added. Submitting needs the store accounts (0.6). Legal wording is Alex's and the lawyer's call (`docs/steps/human-followups.md`).

## Facts the answers rest on

| Fact | Evidence |
|------|----------|
| No tracking, no ATT prompt, no `NSUserTrackingUsageDescription` | `apps/mobile/src/lib/no-att.test.ts`; 1C.8 decision |
| No analytics or Firebase SDK in the app until 1C.8c ships | `apps/mobile/package.json` has no Firebase package; `grep -rli firebase apps/mobile` finds no match outside `node_modules` |
| No advertising SDK, no ad ID | `apps/mobile/package.json` |
| Sentry is initialised with the DSN only, no `setUser`, no `sendDefaultPii` (SDK default: false) | `apps/mobile/src/lib/sentry.ts`; `grep -rn "setUser\|sendDefaultPii" apps/mobile/src apps/mobile/app` returns nothing |
| Sentry is not consent-gated; processor listed | `docs/COMPLIANCE.md` Roles and processors |
| Session token lives in secure storage | `apps/mobile/src/lib/session.ts` |
| Sign-up collects email, password, role, locale | `apps/mobile/app/(auth)/sign-up.tsx` |
| Location is requested in the foreground, only on a "Near me" tap, and rounded to 2 decimals (~1 km) before it leaves the device | `apps/mobile/src/lib/location.ts`; `apps/mobile/app.config.ts` expo-location plugin (no background keys) |
| Request form sends address lines and the rounded coordinate; studio form sends display name, city and the rounded coordinate | `apps/mobile/src/lib/request-form.ts`, `studio-profile-form.ts`; `docs/DATA-MODEL.md` Request, PhotographerProfile |
| Push token and a device row are registered per device and removed on logout | `apps/mobile/src/lib/push.ts`; `docs/COMPLIANCE.md` notifications retention |
| An app-generated random consent ID is kept in secure storage and sent with consent records | `apps/mobile/src/lib/consent-store.ts`, `consent-sync.ts` |
| Payment uses the Stripe PaymentSheet; card data goes from the SDK to Stripe, never to our API | `apps/mobile/src/lib/stripe.ts`, `src/components/bookings/booking-pay-panel.tsx`; `docs/PAYMENTS.md` |
| Uploads (chat, portfolio originals unedited with EXIF, verification documents) go by presigned URL to private EU storage | `apps/mobile/src/lib/chat-attachments.ts`, `portfolio-upload.ts`, `verification-upload.ts`; `packages/shared/src/contract/uploads.ts` |
| Account deletion is started in the app (1C.9a) and on the web at `/account` | `apps/mobile/src/lib/data-requests.ts`; `apps/web/src/app/[locale]/account/delete-account-action.tsx` |

## iOS privacy manifest

Source: `apps/mobile/app.config.ts` `ios.privacyManifests`. Manifests bundled by SDKs merge at build; the app manifest only adds what the app and its un-manifested modules use.

| Category | Reason | Why the app declares it | Evidence |
|----------|--------|-------------------------|----------|
| UserDefaults | CA92.1 | `@stripe/stripe-react-native` calls `UserDefaults.standard` from its own bridge, which ships no manifest | `node_modules/@stripe/stripe-react-native/ios/StripeSdkImpl.swift:170` |
| FileTimestamp | 3B52.1 | `expo-document-picker` reads `contentModificationDate` of user-chosen files and ships no manifest | `node_modules/expo-document-picker/ios/DocumentPickerModule.swift:136` |

Not declared by the app because an SDK already declares it:

| Category | Declared by |
|----------|-------------|
| UserDefaults CA92.1 | `expo-constants`, `expo-localization`, `expo-notifications`, `expo-system-ui`, React Native core (`React/Resources`) |
| SystemBootTime 35F9.1 | `expo-device`, React Native `cxxreact` |
| FileTimestamp C617.1 | React Native core (`React/Resources`) |
| FileTimestamp 0A2A.1, 3B52.1 and DiskSpace E174.1, 85F4.1 | `expo-file-system` (transitive of `expo`) |

Modules with no required-reason API in their iOS sources (grep for timestamp, boot time, disk space, user defaults, active keyboard APIs found nothing): `expo-secure-store` (Keychain is not a required-reason API), `expo-crypto`, `expo-image-picker`, `expo-location`, `expo-image-manipulator`, `expo-web-browser`, `expo-linking`, `expo-router`, `expo-splash-screen`, `expo-status-bar`, `@react-native-community/datetimepicker`, `react-native-screens`, `react-native-reanimated`, `react-native-gesture-handler`, `react-native-safe-area-context`, `react-native-worklets`.

`NSPrivacyTracking` is `false`, `NSPrivacyTrackingDomains` is empty. `NSPrivacyCollectedDataTypes` mirrors the App Store table below; all entries use the purpose App Functionality, and tracking is false everywhere. Guarded by `apps/mobile/src/lib/privacy-manifest.test.ts`.

## App Store privacy labels

Tracking: **No** (no data is combined with third-party data for ads or shared with data brokers).

| Apple data type | Collected | Linked to user | Tracking | Purpose | Justification |
|-----------------|-----------|----------------|----------|---------|---------------|
| Email address | Yes | Yes | No | App functionality | Sign-up, `app/(auth)/sign-up.tsx`; contract basis, `docs/COMPLIANCE.md` Lawful bases |
| Name | Yes | Yes | No | App functionality | Display name on photographer and professional profiles, `src/lib/studio-profile-form.ts` |
| Physical address | Yes | Yes | No | App functionality | Request address lines, `src/lib/request-form.ts`; `docs/DATA-MODEL.md` Request |
| Coarse location | Yes | Yes | No | App functionality | Rounded to ~1 km, `src/lib/location.ts`; stored on requests and studio profiles; a "Near me" search coordinate is a query parameter and not persisted by the app |
| Photos or videos | Yes | Yes | No | App functionality | Portfolio originals (#589), avatars, covers, chat images, `src/lib/portfolio-upload.ts`, `chat-attachments.ts` |
| Emails or text messages | Yes | Yes | No | App functionality | Chat messages, `src/lib/chat-socket.ts`; retention row for chat in `docs/COMPLIANCE.md` |
| Other user content | Yes | Yes | No | App functionality | Verification documents (#595; Apple has no government-ID type), request and quote text, chat documents; `docs/COMPLIANCE.md` verification retention row (account + 5 years) |
| Payment info | Yes | Yes | No | App functionality (fraud prevention) | Stripe PaymentSheet collects the card and device data for fraud prevention; `human-followups.md` row 1C.6b |
| Purchase history | Yes | Yes | No | App functionality | Bookings and payments, `docs/PAYMENTS.md`; ledger 10 years in `docs/COMPLIANCE.md` |
| User ID | Yes | Yes | No | App functionality | Account ID and the anonymous consent ID, `src/lib/consent-store.ts` |
| Device ID | Yes | Yes | No | App functionality | Expo push token and the device row, `src/lib/push.ts` (no IDFA or IDFV is read by app code) |
| Crash data | Yes | No | No | App functionality | Sentry, `src/lib/sentry.ts`; no user is set |
| Other diagnostic data | Yes | No | No | App functionality | Sentry event context (device model, OS, app version) |
| Product interaction, advertising data, usage data | No | | | | No analytics or ad SDK until 1C.8c |
| Contacts, health, browsing and search history, sensitive info, financial info other than payment, precise location | No | | | | No code path |

## Google Play data safety

Data encrypted in transit: **Yes**. The API client uses the `EXPO_PUBLIC_API_URL` host, which must be `https` in release builds; Android blocks cleartext by default for modern target SDKs. The env schema only requires a URL (`src/lib/env.ts`), so the release profile must set an https URL.
Deletion request: **Yes**, in the app (1C.9a, `src/lib/data-requests.ts`) and on the web at `https://photoo.lu/account`.
Shared with third parties: **No** for every row. Stripe, Sentry, Expo push and storage act as processors (`docs/COMPLIANCE.md` Roles and processors), which Google does not count as sharing. Review this once the lawyer confirms processor roles.

| Play category / type | Collected | Optional | Purposes | Justification |
|----------------------|-----------|----------|----------|---------------|
| Personal info: email address | Yes | Required | App functionality, account management | Sign-up |
| Personal info: name | Yes | Optional | App functionality | Profile display name (photographers and professionals) |
| Personal info: address | Yes | Required for a request | App functionality | Request form |
| Personal info: other (verification identity details) | Yes | Optional, required to be verified | App functionality, compliance | Verification documents (#595), `docs/COMPLIANCE.md` |
| Financial info: payment info | Yes | Optional, required to pay | App functionality, fraud prevention | Stripe SDK |
| Financial info: purchase history | Yes | Required to book | App functionality | Bookings and ledger |
| Location: approximate location | Yes | Optional | App functionality | "Near me", request and studio location; foreground only |
| Photos and videos | Yes | Optional | App functionality | Portfolio, avatar, chat |
| Files and docs | Yes | Optional | App functionality | PDF verification documents and chat documents (`expo-document-picker`) |
| Messages: other in-app messages | Yes | Optional | App functionality | Chat |
| App info and performance: crash logs, diagnostics | Yes | Required (not user-switchable) | Analytics (app stability) | Sentry |
| Device or other IDs | Yes | Optional (push opt-in) | App functionality | Expo push token; consent ID |
| App activity, web browsing, health, contacts, calendar, audio, advertising ID | No | | | No code path; analytics stays "not collected" until 1C.8c |

## Not verifiable from this repo

| Claim | Why | Check |
|-------|-----|-------|
| `Sentry` (8.58.0 pod) and the Stripe iOS pods bundle their own `PrivacyInfo.xcprivacy` | Pods are not in `node_modules`; versions pinned by `node_modules/@sentry/react-native/RNSentry.podspec` and `stripe-react-native.podspec` | After the first EAS iOS build, open the Xcode privacy report (Product > Archive > Generate Privacy Report) and confirm no missing-reason warnings |
| Stripe's own data collection list (device data, fraud signals) | Documented by Stripe, not in code | Compare with Stripe's current SDK privacy page before submission |
| Apple counts a coordinate with 2 decimals as coarse | Recalled from Apple's label definitions, not read offline | Confirm in App Store Connect help before submitting |
| Server logs do not retain the rounded "Near me" coordinate beyond the 30-day log retention | API code not reviewed for this step | Spot-check API request logging |
| Sentry session tracking sends no user identifier | Default SDK behaviour, not exercised on device | Inspect one event in Sentry from a dev build |
| `expo-file-system` is autolinked | Transitive dependency | Confirm in the Xcode privacy report |
