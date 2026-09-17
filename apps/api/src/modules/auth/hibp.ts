import { isPasswordCompromised } from 'better-auth/plugins';
import type { Logger } from 'nestjs-pino';

const HIBP_TIMEOUT_MS = 2000;

// Issue #17: the HIBP check must run only in flows that already reveal
// nothing about account existence (sign-up, password-reset confirm), never
// inside `password.hash`/`password.verify` — those run on sign-in's
// user-not-found timing decoy too, and an outbound HIBP call there leaks
// whether an email is registered. D20 requires failing open on an HIBP
// outage rather than blocking the flow.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`HIBP check timed out after ${String(ms)}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function checkPasswordCompromised(password: string, logger: Logger): Promise<boolean> {
  try {
    return await withTimeout(isPasswordCompromised(password), HIBP_TIMEOUT_MS);
  } catch (error) {
    logger.warn({ err: error }, 'auth: HIBP compromised-password check failed, failing open');
    return false;
  }
}
