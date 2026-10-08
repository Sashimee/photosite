import { Body, Controller, HttpCode, Inject, Patch, Req, UseGuards } from '@nestjs/common';
import { UpdateLocaleRequestSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUTH_INSTANCE } from './auth-instance.provider.js';
import type { Auth } from './auth-instance.js';
import { OriginGuard } from './origin-guard.js';
import { requireSession } from './session.js';
import { mapUser } from './user-mapper.js';

@Controller('me')
@UseGuards(OriginGuard)
export class MeController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Patch('locale')
  @HttpCode(200)
  async updateLocale(
    @Body(new ZodValidationPipe(UpdateLocaleRequestSchema))
    body: ReturnType<(typeof UpdateLocaleRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ): Promise<{ user: ReturnType<typeof mapUser> }> {
    const { user } = await requireSession(this.auth, request);
    const updated = await this.prisma.client.user.update({
      where: { id: user.id },
      data: { locale: body.locale },
    });
    return { user: mapUser(updated) };
  }
}
