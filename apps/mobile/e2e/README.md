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

`e2e/scripts/` holds Maestro `runScript` files (GraalJS, `http` global). They run in the Maestro JVM on the host, not inside the emulator, so they reach the API at `http://localhost:4000` and Mailpit at `http://localhost:8025`, while the app itself uses `10.0.2.2:4000`. Override with `maestro test -e API_URL=... -e MAILPIT_URL=... e2e`. Flows that sign in as a seeded user need `-e SEED_USER_PASSWORD=...` (the workflow passes it; locally use the value you seeded with).

- `create-user.js` generates a unique `e2e-mobile-<role>-<id>@photoo.test` identity and signs it up through the API (`REGISTER=false` only generates it). Outputs `email` and `password`. Seeded users are never touched.
- `mailpit-token.js` polls Mailpit for the verification email to `EMAIL` and outputs the `token` from its `verify-email#token=` link. With `VERIFY=true` it also posts the token to `/v1/auth/verify-email`, which is how the sign-in flow gets a verified account without a second UI pass.
- `start-chat.js` signs in as the client, creates a direct quote on the seeded photographer's first product tier (a conversation only exists with a quote) and outputs `quoteId` and `conversationId`.
- `reply-in-chat.js` signs in as the seeded photographer once, optionally checks (`EXPECT_BODY`) that the app's message reached the server, and posts `REPLY_BODY` into `CONVERSATION_ID`. Outputs `replyMessageId`.
- `send-quote.js` signs in as the client (`CLIENT_EMAIL`, `CLIENT_PASSWORD`) to read its newest request from `/v1/requests/mine`, signs in as the seeded photographer (`sofia.martins@photoo.test`, password `SEED_USER_PASSWORD`) and posts a quote on it to `/v1/quotes`. Outputs `requestId` and `quoteId`. Any non-2xx response throws with the status and body.

The api limits sign-in (5/min) and sign-up (5/hour) per client IP, and the emulator and every script share 127.0.0.1. The workflow therefore sets `TRUSTED_PROXIES=127.0.0.1,::1` and each script sends a random `X-Forwarded-For`, so only the app's own requests count against the emulator's budget. Running locally without `TRUSTED_PROXIES` makes the scripts share it again.

Every auth flow starts from `subflows/fresh-start.yaml` (clear state, decline consent) and `subflows/open-sign-in.yaml` (Account tab, Sign in), so each flow is independent and gets a fresh email.

Email verification: the link in the email points at the web app (`WEB_APP_URL/verify-email#token=...`), which an emulator-only run has no site to open. The sign-up flow therefore reads the token from the same email and types it into the app's own "verification code" field (`verify-email-token`), which posts it to the API. This exercises the app's verification screen rather than a server-side shortcut.

## Request, quote, accept

`flows/request-quote-accept.yaml` signs a fresh verified client in, opens the seeded photographer's profile by deep link (`photoo:///photographers/sofia-martins`), taps "Request a quote" and fills the request form: category, a city picked from the autocomplete (which sets the location, country and so the EUR currency), address, budget and usage. The event date goes through Android's native date and time dialogs (next month, the 15th, then OK twice) because the date must be in the future. After the app shows the created request with no quotes, `send-quote.js` sends the quote as the photographer, the flow opens it by deep link (`photoo:///quotes/<id>`) and accepts it. The pass condition is the booking screen the app navigates to once `POST /v1/quotes/{id}/accept` returns a booking id: the `pending_payment` timeline step is selected and the pay panel is present. The error variants of that screen have their own `testID`s and are asserted absent. The flow stops there; paying is 1C.10e.

The only seeded data it touches is one request and one quote on Sofia Martins, created under a throwaway client.

## Chat

`flows/chat.yaml` signs a fresh verified client in, opens the Messages tab and the conversation `start-chat.js` created, and sends a message from the composer. It waits for the pending bubble to turn into a sent one, then `reply-in-chat.js` confirms the server holds the message and posts Sofia's reply through the API. The pass condition is the reply appearing in the already-open thread, with no navigation or reload in between, so it only passes if the Socket.IO event reaches the app.

Not covered yet: sign out everywhere, role addition and locale switching on the account tab (jest covers them).
