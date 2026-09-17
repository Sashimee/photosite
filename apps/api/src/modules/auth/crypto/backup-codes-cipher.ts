import { decryptAesGcm, encryptAesGcm } from '@photoo/shared/crypto';

export interface BackupCodesCipher {
  encrypt: (token: string) => Promise<string>;
  decrypt: (token: string) => Promise<string>;
}

export function createBackupCodesCipher(authEncryptionKey: Buffer): BackupCodesCipher {
  return {
    encrypt: (token) => Promise.resolve(encryptAesGcm(token, authEncryptionKey)),
    decrypt: (token) => Promise.resolve(decryptAesGcm(token, authEncryptionKey)),
  };
}
