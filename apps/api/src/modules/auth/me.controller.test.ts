import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { Auth } from './auth-instance.js';
import { MeController } from './me.controller.js';

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

function setup(session: unknown) {
  const update = vi.fn(({ data }: { data: { locale: string } }) =>
    Promise.resolve({ ...userRow, locale: data.locale }),
  );
  const auth = { api: { getSession: vi.fn().mockResolvedValue(session) } } as unknown as Auth;
  const prisma = { client: { user: { update } } } as unknown as PrismaService;
  const request = { headers: { authorization: 'Bearer t' } } as unknown as FastifyRequest;
  return { controller: new MeController(auth, prisma), update, request };
}

describe('MeController.updateLocale', () => {
  it('updates only the session user and returns the new locale', async () => {
    const { controller, update, request } = setup({ user: userRow, session: { id: 's' } });

    const result = await controller.updateLocale({ locale: 'fr' }, request);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({ where: { id: userRow.id }, data: { locale: 'fr' } });
    expect(result.user.locale).toBe('fr');
    expect(result.user.id).toBe(userRow.id);
    expect(result.user.country).toBe('LU');
  });

  it('answers 401 and writes nothing without a session', async () => {
    const { controller, update, request } = setup(null);

    await expect(controller.updateLocale({ locale: 'fr' }, request)).rejects.toMatchObject({
      status: 401,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
