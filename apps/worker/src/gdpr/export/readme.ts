// Static copy, not i18n: this ships inside the archive itself, addressed to
// whoever opens the zip, not rendered by the app (docs/steps/1A.12-gdpr.md
// "One JSON file per entity plus a README.txt").
export function buildReadmeText(): string {
  return `Photoo.lu data export
=====================

This archive contains the personal data associated with your Photoo.lu
account, as required by Article 15/20 of the GDPR.

manifest.json lists every file in this archive and how many rows it
contains, along with the version of our privacy policy in force when this
export was generated.

Each other .json file holds one type of record:

- user.json, accounts.json: your account and linked sign-in methods.
- sessions.json, devices.json: your active sign-in sessions and devices.
- consents.json: your consent choices.
- notifications.json: notifications sent to you.
- requests.json, quotes.json: photo requests and quotes you sent or
  received.
- photographer-profile.json, products.json, portfolio-images.json: your
  public photographer profile, if you have one.
- uploads.json: metadata about files you uploaded.
- verification-cases.json: your professional verification case, if any.
  This file lists the documents you submitted by name and metadata only;
  the document files themselves are not included here. If you need a copy
  of a submitted identity or business document, contact support and we
  will verify your identity before releasing it.
- messages.json: every message in every conversation you took part in.
  The other person in each conversation is identified only by their
  display name and public profile link, never by their email, phone
  number or address.

files/ contains the original image files you uploaded: your portfolio
images, avatar and cover photo, if any.

This export does not include internal moderation records, other users'
personal data, or the technical detail behind our automated image checks.
`;
}
