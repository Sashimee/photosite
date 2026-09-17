import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CreateProductRequestSchema,
  IdSchema,
  SlugSchema,
  UpdateProductRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { ProductsService } from './products.service.js';

@Controller()
@UseGuards(OriginGuard)
export class ProductsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(ProductsService) private readonly products: ProductsService,
  ) {}

  @Get('photographers/:slug/products')
  async listPublic(@Param('slug', new ZodValidationPipe(SlugSchema)) slug: string) {
    return this.products.listPublicForSlug(slug);
  }

  @Get('me/products')
  async listOwn(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.products.listOwn(user);
  }

  @Post('me/products')
  async create(
    @Body(new ZodValidationPipe(CreateProductRequestSchema))
    body: ReturnType<(typeof CreateProductRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.products.create(user, body);
  }

  @Get('me/products/:productId')
  async getOwn(
    @Param('productId', new ZodValidationPipe(IdSchema)) productId: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.products.getOwn(user, productId);
  }

  @Patch('me/products/:productId')
  async update(
    @Param('productId', new ZodValidationPipe(IdSchema)) productId: string,
    @Body(new ZodValidationPipe(UpdateProductRequestSchema))
    body: ReturnType<(typeof UpdateProductRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.products.update(user, productId, body);
  }

  @HttpCode(204)
  @Delete('me/products/:productId')
  async delete(
    @Param('productId', new ZodValidationPipe(IdSchema)) productId: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    await this.products.delete(user, productId);
  }
}
