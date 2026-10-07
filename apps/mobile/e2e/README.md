# Mobile end-to-end tests (Maestro)

Flows in `e2e/flows/` run, ordered by `e2e/config.yaml`, against an Android release build with the JS bundled in, talking to a local API. CI runs them in `.github/workflows/mobile-e2e.yml`; this is how to do the same locally. Selectors are `testID`s (Maestro `id:`), not copy.

## Prerequisites

- Android SDK with platform 34 and an x86_64 system image, plus an AVD (`avdmanager create avd -n photoo-e2e -k "system-images;android-34;google_apis;x86_64"`). KVM enabled on Linux.
- JDK 17 and `ANDROID_HOME` set.
- Maestro CLI, pinned to the version in the workflow: `curl -fsSL https://get.maestro.mobile.dev | MAESTRO_VERSION=2.11.0 bash`.
- The local stack, API and worker running: `pnpm stack:up`, `pnpm --filter @photoo/db run migrate:deploy && pnpm db:seed`, then `STRIPE_FAKE=true pnpm --filter @photoo/api start` and `pnpm --filter @photoo/worker start`. The API binds `0.0.0.0`, so the emulator reaches it at `10.0.2.2:4000`.

## Build and run

```
cd apps/mobile
E2E_BUILD=1 EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 npx expo prebuild --platform android --clean
(cd android && ./gradlew assembleRelease)
emulator -avd photoo-e2e &
adb install -r android/app/build/outputs/apk/release/app-release.apk
maestro test e2e
```

`E2E_BUILD=1` is the only thing that allows cleartext HTTP (`plugins/with-cleartext-traffic.ts`); no EAS profile sets it. `android/` is generated and gitignored. The release build is signed with the debug keystore the prebuild template ships.

Reports and screenshots land in `~/.maestro/tests`.

## Fixtures and the auth flows

`e2e/scripts/` holds Maestro `runScript` files (GraalJS, `http` global). They run in the Maestro JVM on the host, not inside the emulator, so they reach the API at `http://localhost:4000` and Mailpit at `http://localhost:8025`, while the app itself uses `10.0.2.2:4000`. Override with `maestro test -e API_URL=... -e MAILPIT_URL=... e2e`.

- `create-user.js` generates a unique `e2e-mobile-<role>-<id>@photoo.test` identity and signs it up through the API (`REGISTER=false` only generates it). Outputs `email` and `password`. Seeded users are never touched.
- `mailpit-token.js` polls Mailpit for the verification email to `EMAIL` and outputs the `token` from its `verify-email#token=` link. With `VERIFY=true` it also posts the token to `/v1/auth/verify-email`, which is how the sign-in flow gets a verified account without a second UI pass.

Every auth flow starts from `subflows/fresh-start.yaml` (clear state, decline consent) and `subflows/open-sign-in.yaml` (Account tab, Sign in), so each flow is independent and gets a fresh email.

Email verification: the link in the email points at the web app (`WEB_APP_URL/verify-email#token=...`), which an emulator-only run has no site to open. The sign-up flow therefore reads the token from the same email and types it into the app's own "verification code" field (`verify-email-token`), which posts it to the API. This exercises the app's verification screen rather than a server-side shortcut.

Not covered yet: sign out everywhere, role addition and locale switching on the account tab (jest covers them).
