# #583 Device (push token) retention

Agents: api-developer (worker sweep, docs), mobile-developer (unregister on revoked permission), test-writer, compliance-reviewer.

A `Device` row (Expo push token, platform, `lastSeenAt`) is removed in four cases: sign-out, `DeviceNotRegistered` from Expo, the 10-device cap, or account deletion. Nothing expires it by age. A device whose user turned notifications off in OS settings keeps its row. `docs/COMPLIANCE.md` has no retention row for devices, doesn't name APNs/FCM as recipients, and doesn't give a lawful basis for push.

## Tasks

1. **Worker sweep (api-developer).** Delete `Device` rows whose `lastSeenAt` is more than 12 months old. Put it in the existing `notifications-cleanup` processor (`apps/worker/src/queues/processors/notifications-cleanup.processor.ts`), which already runs the 12-month notification purge on a schedule. Use a named constant. Log counts only; no `AuditLog`. Add unit and integration tests:
   - an old device is deleted;
   - a recent device is kept;
   - a second run deletes nothing.
2. **Mobile (mobile-developer).** In `registerPushDevice` (`apps/mobile/src/lib/push.ts`), when permission is no longer granted and a stored device id exists, call `DELETE /v1/me/devices/{id}` and forget the stored id. A failed delete must not block the app; send it to Sentry without the token. Add jest tests for three cases: revoked with a stored id, revoked without a stored id, and a failed delete.
3. **Docs (api-developer).** In `docs/COMPLIANCE.md`:
   - Add a retention row: "Push devices (Expo token, platform, last seen): until sign-out, uninstall (`DeviceNotRegistered`), revoked permission or account deletion, and at most 12 months after last seen; deleted by `notifications-cleanup`".
   - Name Apple APNs and Google FCM, via Expo, in the processors/recipients line.
   - Add push notifications to the contract row of the lawful-basis table.
   - The export README (`apps/worker/src/gdpr/export/readme.ts`) says the push token is left out of `devices.json` on purpose.

No schema, contract or API change: `DELETE /v1/me/devices/{id}` already exists.
