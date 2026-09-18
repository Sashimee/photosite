// A list of admin users must not put every email address on screen at
// once (docs/steps/1D.2-admin-users.md): screenshots of admin tools leak,
// and a support admin scrolling a list does not need the full address. The
// detail page shows the full email; this is only for the list view.
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) {
    return email;
  }
  return `${email.charAt(0)}***${email.slice(at)}`;
}
