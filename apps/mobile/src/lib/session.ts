import * as SecureStore from 'expo-secure-store';

const SESSION_TOKEN_KEY = 'photoo.session.token';
const SESSION_EXPIRES_AT_KEY = 'photoo.session.expiresAt';

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface StoredSession {
  token: string;
  expiresAt: string;
}

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY, STORE_OPTIONS);
}

export async function setSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, STORE_OPTIONS);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, STORE_OPTIONS);
}

async function getSessionExpiresAt(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_EXPIRES_AT_KEY, STORE_OPTIONS);
}

async function setSessionExpiresAt(expiresAt: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_EXPIRES_AT_KEY, expiresAt, STORE_OPTIONS);
}

async function clearSessionExpiresAt(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_EXPIRES_AT_KEY, STORE_OPTIONS);
}

// The bearer token and its expiry are always written and cleared together, so
// a boot check never sees one without the other.
export async function getStoredSession(): Promise<StoredSession | null> {
  const [token, expiresAt] = await Promise.all([getSessionToken(), getSessionExpiresAt()]);
  return token && expiresAt ? { token, expiresAt } : null;
}

export async function setStoredSession(session: StoredSession): Promise<void> {
  await Promise.all([setSessionToken(session.token), setSessionExpiresAt(session.expiresAt)]);
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([clearSessionToken(), clearSessionExpiresAt()]);
}
