import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuditLogService } from '../../common/audit/audit-log.service.js';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ChatSocketBridge } from '../chat/chat-socket-bridge.js';
import type { Auth } from './auth-instance.js';
import type { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthController } from './auth.controller.js';

const userRow = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'client@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  countryCode: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
};

const expiresAt = new Date('2030-01-01T00:00:00Z');

function setup(verifyResponse: Response) {
  const calls: string[] = [];
  const sessionDeleteMany = vi.fn(() => {
    calls.push('sessions');
    return Promise.resolve({ count: 1 });
  });
  const deviceDeleteMany = vi.fn(() => {
    calls.push('devices');
    return Promise.resolve({ count: 1 });
  });
  const sessionUpdate = vi.fn().mockResolvedValue({});
  const client = {
    session: { deleteMany: sessionDeleteMany, update: sessionUpdate },
    device: { deleteMany: deviceDeleteMany },
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const verifyTOTP = vi.fn(() => {
    calls.push('verify');
    return Promise.resolve(verifyResponse);
  });
  const getSession = vi.fn(({ headers }: { headers: Headers }) => {
    const bearer = headers.get('authorization');
    if (bearer === 'Bearer rotated') {
      return Promise.resolve({
        user: userRow,
        session: { id: 'rotated-id', expiresAt, twoFactorVerifiedAt: null },
      });
    }
    return Promise.resolve({
      user: userRow,
      session: { id: 'old-id', expiresAt, twoFactorVerifiedAt: null },
    });
  });
  const auth = { api: { getSession, verifyTOTP } } as unknown as Auth;
  const controller = new AuthController(
    auth,
    {} as Env,
    { client } as unknown as PrismaService,
    {} as AuditLogService,
    { enforce: vi.fn().mockResolvedValue(undefined) } as unknown as AuthRateLimitService,
    {} as ChatSocketBridge,
    {} as never,
  );
  const send = vi.fn();
  const reply = {
    raw: { setHeader: vi.fn() },
    status: vi.fn(),
    send,
  } as unknown as FastifyReply;
  const request = {
    headers: { authorization: 'Bearer old' },
    ip: '127.0.0.1',
  } as unknown as FastifyRequest;
  return {
    controller,
    reply,
    request,
    send,
    calls,
    sessionDeleteMany,
    deviceDeleteMany,
    sessionUpdate,
  };
}

describe('AuthController.totpVerify', () => {
  it('deletes no sessions or devices when the code is wrong', async () => {
    const wrong = new Response(JSON.stringify({ code: 'INVALID_CODE', message: 'Invalid code' }), {
      status: 401,
    });
    const { controller, request, reply, sessionDeleteMany, deviceDeleteMany } = setup(wrong);

    await expect(controller.totpVerify({ code: '000000' }, request, reply)).rejects.toMatchObject({
      status: 401,
    });
    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(deviceDeleteMany).not.toHaveBeenCalled();
  });

  it('revokes other sessions and devices after verify, keeping the rotated session', async () => {
    const ok = new Response(JSON.stringify({ status: true }), {
      status: 200,
      headers: { 'set-auth-token': 'rotated' },
    });
    const { controller, request, reply, send, calls, sessionDeleteMany, deviceDeleteMany } =
      setup(ok);

    await controller.totpVerify({ code: '123456' }, request, reply);

    expect(calls[0]).toBe('verify');
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: userRow.id, id: { not: 'rotated-id' } },
    });
    expect(deviceDeleteMany).toHaveBeenCalledWith({ where: { userId: userRow.id } });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        session: { token: 'rotated', expiresAt: expiresAt.toISOString() },
      }),
    );
  });

  it('keeps the calling session when verify did not rotate it', async () => {
    const ok = new Response(JSON.stringify({ status: true }), { status: 200 });
    const { controller, request, reply, sessionDeleteMany } = setup(ok);

    await controller.totpVerify({ code: '123456' }, request, reply);

    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: userRow.id, id: { not: 'old-id' } },
    });
  });
});
