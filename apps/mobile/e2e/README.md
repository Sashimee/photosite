# Mobile end-to-end tests (Maestro)

Flows in `e2e/flows/` run against an Android release build with the JS bundled in, talking to a local API. CI runs them in `.github/workflows/mobile-e2e.yml`; this is how to do the same locally. Selectors are `testID`s (Maestro `id:`), not copy.

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
maestro test e2e/flows
```

`E2E_BUILD=1` is the only thing that allows cleartext HTTP (`plugins/with-cleartext-traffic.ts`); no EAS profile sets it. `android/` is generated and gitignored. The release build is signed with the debug keystore the prebuild template ships.

Reports and screenshots land in `~/.maestro/tests`.
