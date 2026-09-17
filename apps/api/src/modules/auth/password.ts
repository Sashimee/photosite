import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

export function createPasswordHasher(): {
  hash: (password: string) => Promise<string>;
  verify: (data: { hash: string; password: string }) => Promise<boolean>;
} {
  return {
    hash: (password: string) => argon2Hash(password),
    verify: ({ hash, password }) => argon2Verify(hash, password),
  };
}
