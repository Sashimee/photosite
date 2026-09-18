import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AdminUserSearchQuerySchema,
  IdSchema,
  SetUserRolesRequestSchema,
  SuspendUserRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminMutationRateLimitService } from './admin-mutation-rate-limit.service.js';
import { AdminUsersService } from './admin-users.service.js';

@Controller('admin/users')
@UseGuards(OriginGuard)
export class AdminUsersController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminUsersService) private readonly adminUsers: AdminUsersService,
    @Inject(AdminMutationRateLimitService)
    private readonly rateLimit: AdminMutationRateLimitService,
  ) {}

  @Get()
  async search(
    @Query(new ZodValidationPipe(AdminUserSearchQuerySchema))
    query: ReturnType<(typeof AdminUserSearchQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'support');
    return this.adminUsers.search(query);
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'support');
    return this.adminUsers.get(id);
  }

  @HttpCode(200)
  @Post(':id/suspend')
  async suspend(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SuspendUserRequestSchema))
    body: ReturnType<(typeof SuspendUserRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'support');
    await this.rateLimit.enforce(user.id);
    return this.adminUsers.suspend(user, id, body.reason, request.ip);
  }

  @HttpCode(200)
  @Post(':id/reactivate')
  async reactivate(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'support');
    await this.rateLimit.enforce(user.id);
    return this.adminUsers.reactivate(user, id, request.ip);
  }

  @HttpCode(200)
  @Put(':id/roles')
  async setRoles(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SetUserRolesRequestSchema))
    body: ReturnType<(typeof SetUserRolesRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'superadmin');
    await this.rateLimit.enforce(user.id);
    return this.adminUsers.setRoles(user, id, body.roles, request.ip);
  }
}
