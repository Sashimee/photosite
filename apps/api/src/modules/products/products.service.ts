import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import type {
  CreateProductRequestSchema,
  ProductSchema,
  UpdateProductRequestSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { toPrismaCategory } from '../../common/enums/photographer-category.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { mapProduct } from './product-mapper.js';

interface SessionUser {
  id: string;
  roles: string[];
}
type CreateInput = z.infer<typeof CreateProductRequestSchema>;
type UpdateInput = z.infer<typeof UpdateProductRequestSchema>;
type ProductDto = z.infer<typeof ProductSchema>;

function notFound(message: string): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

function invalidCurrency(): HttpException {
  return new HttpException(
    { code: 'UNPROCESSABLE_ENTITY', message: "currency must match the profile country's currency" },
    422,
  );
}

function duplicateTierUsage(): HttpException {
  return new HttpException(
    { code: 'UNPROCESSABLE_ENTITY', message: 'tiers must have distinct usage values' },
    422,
  );
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
  ) {}

  async listPublicForSlug(slug: string): Promise<ProductDto[]> {
    const profile = await this.prisma.client.photographerProfile.findUnique({ where: { slug } });
    if (!profile || profile.deletedAt || !profile.isPublished) {
      throw notFound('Photographer profile not found');
    }

    const products = await this.prisma.client.product.findMany({
      where: { profileId: profile.id, isActive: true, deletedAt: null },
      orderBy: { order: 'asc' },
      include: { tiers: true },
    });

    return products.map(mapProduct);
  }

  async listOwn(user: SessionUser): Promise<ProductDto[]> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);

    const products = await this.prisma.client.product.findMany({
      where: { profileId: profile.id, deletedAt: null },
      orderBy: { order: 'asc' },
      include: { tiers: true },
    });

    return products.map(mapProduct);
  }

  async getOwn(user: SessionUser, productId: string): Promise<ProductDto> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);
    const product = await this.findOwnedOrThrow(profile.id, productId);
    return mapProduct(product);
  }

  async create(user: SessionUser, input: CreateInput): Promise<ProductDto> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);
    const currency = await this.requireProfileCurrency(profile.countryCode);

    this.assertNoDuplicateTierUsage(input.tiers);
    if (input.basePrice.currency !== currency) {
      throw invalidCurrency();
    }
    for (const tier of input.tiers) {
      if (tier.price.currency !== currency) {
        throw invalidCurrency();
      }
    }

    const order = input.order ?? (await this.nextOrder(profile.id));

    const created = await this.prisma.client.product.create({
      data: {
        profileId: profile.id,
        title: input.title,
        description: input.description ?? Prisma.JsonNull,
        category: toPrismaCategory(input.category),
        durationMinutes: input.durationMinutes,
        deliverables: input.deliverables,
        basePriceCents: input.basePrice.amountCents,
        currency: input.basePrice.currency,
        isActive: input.isActive ?? true,
        order,
        tiers: {
          create: input.tiers.map((tier) => ({
            usage: tier.usage,
            priceCents: tier.price.amountCents,
            currency: tier.price.currency,
            description: tier.description,
            licenceTextVersion: tier.licenceTextVersion,
          })),
        },
      },
      include: { tiers: true },
    });

    return mapProduct(created);
  }

  async update(user: SessionUser, productId: string, input: UpdateInput): Promise<ProductDto> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);
    const existing = await this.findOwnedOrThrow(profile.id, productId);
    const currency = await this.requireProfileCurrency(profile.countryCode);

    if (input.tiers !== undefined) {
      this.assertNoDuplicateTierUsage(input.tiers);
      for (const tier of input.tiers) {
        if (tier.price.currency !== currency) {
          throw invalidCurrency();
        }
      }
    }
    if (input.basePrice !== undefined && input.basePrice.currency !== currency) {
      throw invalidCurrency();
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (input.tiers !== undefined) {
        await tx.productTier.deleteMany({ where: { productId: existing.id } });
      }

      return tx.product.update({
        where: { id: existing.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description ?? Prisma.JsonNull }
            : {}),
          ...(input.category !== undefined ? { category: toPrismaCategory(input.category) } : {}),
          ...(input.durationMinutes !== undefined
            ? { durationMinutes: input.durationMinutes }
            : {}),
          ...(input.deliverables !== undefined ? { deliverables: input.deliverables } : {}),
          ...(input.basePrice !== undefined
            ? { basePriceCents: input.basePrice.amountCents, currency: input.basePrice.currency }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.order !== undefined ? { order: input.order } : {}),
          ...(input.tiers !== undefined
            ? {
                tiers: {
                  create: input.tiers.map((tier) => ({
                    usage: tier.usage,
                    priceCents: tier.price.amountCents,
                    currency: tier.price.currency,
                    description: tier.description,
                    licenceTextVersion: tier.licenceTextVersion,
                  })),
                },
              }
            : {}),
        },
        include: { tiers: true },
      });
    });

    return mapProduct(updated);
  }

  async delete(user: SessionUser, productId: string): Promise<void> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);
    const existing = await this.findOwnedOrThrow(profile.id, productId);

    await this.prisma.client.product.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  private assertNoDuplicateTierUsage(tiers: readonly { usage: string }[]): void {
    const usages = tiers.map((tier) => tier.usage);
    if (new Set(usages).size !== usages.length) {
      throw duplicateTierUsage();
    }
  }

  private async nextOrder(profileId: string): Promise<number> {
    const { _count } = await this.prisma.client.product.aggregate({
      where: { profileId, deletedAt: null },
      _count: { _all: true },
    });
    return _count._all + 1;
  }

  private async requireProfileCurrency(countryCode: string): Promise<string> {
    const country = await this.prisma.client.country.findUnique({ where: { code: countryCode } });
    if (!country) {
      throw new Error(`products: profile country "${countryCode}" is missing from Country`);
    }
    return country.currency;
  }

  private async findOwnedOrThrow(profileId: string, productId: string) {
    const product = await this.prisma.client.product.findUnique({
      where: { id: productId },
      include: { tiers: true },
    });
    if (!product || product.deletedAt) {
      throw notFound('Product not found');
    }
    if (product.profileId !== profileId) {
      throw notFound('Product not found');
    }
    return product;
  }
}
