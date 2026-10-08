# #671 Mobile TOTP settings

Agents: mobile-developer, test-writer, security-reviewer.

The TOTP parts of 1C.2b tasks 1, 2 and 5, deferred until #23 (merged via #669) let bearer clients keep their session.

## API as it stands

- `POST /v1/auth/totp/enroll` `{ password }` → `{ secret, otpauthUrl, backupCodes }`.
- `POST /v1/auth/totp/verify` `{ code }` → `{ user, session? }`. On first verification the session rotates and `session` carries the new `{ token, expiresAt }`; the old bearer is already dead. Enabling also deletes the user's **other** sessions and **all** registered push devices.
- `POST /v1/auth/totp/disable` `{ code, password }` → `{ user }`.
- `User.twoFactorEnabled` tells the account screen which action to offer.

## Tasks (mobile-developer, `feat/671-mobile-totp`)

1. Account tab: a "Two-factor authentication" row showing on/off from `user.twoFactorEnabled`, opening the enrol or disable flow. Signed-in only.
2. Enrol flow (its own stack screen(s)):
   1. Password prompt → `enroll`.
   2. Show the secret (selectable, copy action) and an "Open in authenticator app" action for `otpauthUrl` (`Linking.openURL`; tolerate no handler). Show the backup codes with a copy action and an explicit "I stored these" confirmation; the codes live in component state only and are never shown again after confirmation (not persisted, not in route params, not logged).
   3. Code entry → `verify`. If the response carries `session`, write it with `setStoredSession` **before** any other request, then `updateUser`. Re-register the push device afterwards, since enabling removed it.
   4. Wrong code (400/401 `INVALID_CODE`) stays on the code step; leaving the flow before verify leaves 2FA off (the server only enables on verify).
3. Disable flow: code + password → `disable` → `updateUser`.
4. Copy in `packages/i18n` (`en`; other locales fall back as for the rest of `mobile.*`).
5. Tests (jest-expo): enrol happy path stores the rotated session before `updateUser` and re-registers push; verify without `session` keeps the current token; backup codes are gone after confirmation; wrong code stays; disable updates the user; password errors surface.

## Out of scope

Regenerating backup codes; a Maestro flow (needs a TOTP generator in the flow — file as a follow-up if not trivial). No API or contract change.
