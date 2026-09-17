import { Inject, Injectable } from '@nestjs/common';
import { decryptAesGcm, encryptAesGcm } from '@photoo/shared/crypto';
import { APP_CONFIG, type Env } from '../../config/env.js';

@Injectable()
export class VerificationEncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.key = config.VERIFICATION_ENCRYPTION_KEY;
  }

  encrypt(plaintext: string): string;
  encrypt(plaintext: string | null): string | null;
  encrypt(plaintext: string | null): string | null {
    return plaintext === null ? null : encryptAesGcm(plaintext, this.key);
  }

  decrypt(ciphertext: string): string;
  decrypt(ciphertext: string | null): string | null;
  decrypt(ciphertext: string | null): string | null {
    return ciphertext === null ? null : decryptAesGcm(ciphertext, this.key);
  }
}
