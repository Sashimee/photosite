# Store listing (1C.9c)

Drafts of the App Store and Google Play listings. English is the source; fr, de, pt and es are drafts that need a native review. Nothing is pushed to a store until the accounts exist (0.6). Limits are enforced by `apps/mobile/src/lib/store-listing.test.ts`.

## Where the files are

| Store | Files | How they are used |
|-------|-------|-------------------|
| App Store | `apps/mobile/store.config.json` | `eas metadata:push` (EAS Metadata, `configVersion: 0`): title, subtitle, description, keywords, release notes, URLs, categories, review contact |
| Google Play | `apps/mobile/store/play/<locale>/{title,short_description,full_description}.txt` | fastlane supply layout; EAS Metadata does not cover Play, so paste into the Play Console or use `fastlane supply` |

Locales: en-US, fr-FR, de-DE, pt-PT, es-ES. Limits: Apple title and subtitle 30, keywords 100 (joined with commas), description 4000; Play title 30, short description 80, full description 4000.

## URLs

| Use | URL |
|-----|-----|
| Privacy policy | `https://photoo.lu/<locale>/legal/privacy` (still a placeholder page until the lawyer text lands, 0.7) |
| Support (App Store) | `https://photoo.lu/<locale>/legal/imprint`, the only page with a contact address (`hello@photoo.lu`); there is no support page |
| Marketing | `https://photoo.lu/<locale>` |
| Play account deletion | No public page exists yet (#627). `https://photoo.lu/en/account` is behind sign-in and Google rejects that. Needs a public page whose retention wording matches #426 |

## Alex must review

- `apple.review` in `store.config.json`: contact first and last name, email, phone, demo account username and password (all marked `TODO-ALEX`). Apple requires a working demo sign-in.
- Support URL: replace the imprint with a real support page, or confirm the imprint is acceptable.
- All copy: marketing and legal review. The text claims payment is held until delivery and that photographers can be verified; both match the code, but confirm the wording with the lawyer.
- fr, de, pt, es drafts: native review.
- Age rating, `apple.advisory` and copyright holder are not set; they are answered in App Store Connect.
- Categories `PHOTO_AND_VIDEO` (primary) and `LIFESTYLE` (secondary) are a suggestion.
- Release notes are for the first release only.
