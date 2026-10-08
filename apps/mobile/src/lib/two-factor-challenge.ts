// Memory only: the token is a bearer credential for the second sign-in step, so
// it must not reach SecureStore/AsyncStorage, route params (navigation state and
// Sentry breadcrumbs record URLs), or logs.
let challengeToken: string | null = null;

export function setTwoFactorChallenge(token: string): void {
  challengeToken = token;
}

export function getTwoFactorChallenge(): string | null {
  return challengeToken;
}

export function clearTwoFactorChallenge(): void {
  challengeToken = null;
}
