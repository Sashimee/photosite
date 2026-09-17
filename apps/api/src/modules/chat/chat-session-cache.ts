import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';

const SESSION_VALIDITY_TTL_SECONDS = 30;

function sessionKey(sessionId: string): string {
  return `chat:session-valid:${sessionId}`;
}

// M1: a chat socket is authenticated once, at handshake, so a session
// revoked afterwards (sign-out, password reset, revoke-all) must still be
// re-checked periodically rather than trusted for the socket's lifetime.
// Caching the positive/negative result for <=30s keeps that check off the
// database on every single event while bounding how long a revoked session
// can still emit messages through an already-open socket.
@Injectable()
export class ChatSessionCache {
  constructor(
    @Inject(RedisService) private readonly redisService: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async isValid(sessionId: string): Promise<boolean> {
    const cached = await this.redisService.client.get(sessionKey(sessionId));
    if (cached !== null) {
      return cached === '1';
    }

    const session = await this.prisma.client.session.findUnique({
      where: { id: sessionId },
      select: { expiresAt: true },
    });
    const valid = session !== null && session.expiresAt.getTime() > Date.now();
    await this.redisService.client.set(
      sessionKey(sessionId),
      valid ? '1' : '0',
      'EX',
      SESSION_VALIDITY_TTL_SECONDS,
    );
    return valid;
  }
}
