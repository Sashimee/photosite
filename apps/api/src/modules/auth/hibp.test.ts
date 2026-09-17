import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

vi.mock('better-auth/plugins', () => ({
  isPasswordCompromised: vi.fn(),
}));

const NOOP_LOGGER = { warn: vi.fn() } as unknown as Logger;

describe('checkPasswordCompromised', () => {
  it('returns true when the password is compromised', async () => {
    const { isPasswordCompromised } = await import('better-auth/plugins');
    vi.mocked(isPasswordCompromised).mockResolvedValueOnce(true);
    const { checkPasswordCompromised } = await import('./hibp.js');

    expect(await checkPasswordCompromised('breached', NOOP_LOGGER)).toBe(true);
  });

  it('fails open (returns false) and logs a warning when the check throws', async () => {
    const { isPasswordCompromised } = await import('better-auth/plugins');
    vi.mocked(isPasswordCompromised).mockRejectedValueOnce(new Error('network down'));
    const { checkPasswordCompromised } = await import('./hibp.js');
    const warn = vi.fn();
    const logger = { warn } as unknown as Logger;

    expect(await checkPasswordCompromised('anything', logger)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('fails open when the check does not resolve within the timeout', async () => {
    const { isPasswordCompromised } = await import('better-auth/plugins');
    vi.mocked(isPasswordCompromised).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(true);
          }, 5000);
        }),
    );
    const { checkPasswordCompromised } = await import('./hibp.js');
    const warn = vi.fn();
    const logger = { warn } as unknown as Logger;

    expect(await checkPasswordCompromised('slow', logger)).toBe(false);
    expect(warn).toHaveBeenCalled();
  }, 3000);
});
