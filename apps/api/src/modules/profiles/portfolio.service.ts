import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PortfolioImageSchema } from '@photoo/shared';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { isAttachableUploadStatus } from '../../common/enums/upload-status.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { mapPortfolioImage } from './profile-mapper.js';
import { PortfolioCleanupQueueService } from './portfolio-cleanup-queue.service.js';
import { decodePortfolioCursor, encodePortfolioCursor } from './portfolio-cursor.js';
import { ProfilesService } from './profiles.service.js';

interface SessionUser {
  id: string;
  roles: string[];
}
type PortfolioImageDto = z.infer<typeof PortfolioImageSchema>;

function notFound(message: string): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

@Injectable()
export class PortfolioService {
  private readonly baseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
    @Inject(PortfolioCleanupQueueService)
    private readonly cleanupQueue: PortfolioCleanupQueueService,
    @Inject(APP_CONFIG) config: Env,
  ) {
    this.baseUrl = config.S3_PUBLIC_BASE_URL;
  }

  async listOwn(
    user: SessionUser,
    query: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: PortfolioImageDto[]; nextCursor: string | null }> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);
    const cursor = query.cursor ? decodePortfolioCursor(query.cursor) : undefined;

    const rows = await this.prisma.client.portfolioImage.findMany({
      where: {
        profileId: profile.id,
        deletedAt: null,
        ...(cursor
          ? {
              OR: [{ order: { gt: cursor.order } }, { order: cursor.order, id: { gt: cursor.id } }],
            }
          : {}),
      },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: { upload: true },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodePortfolioCursor(last.order, last.id) : null;

    return {
      items: page.map((row) => mapPortfolioImage(row, row.upload, this.baseUrl)),
      nextCursor,
    };
  }

  async attach(user: SessionUser, uploadId: string): Promise<PortfolioImageDto> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);

    const upload = await this.prisma.client.upload.findUnique({ where: { id: uploadId } });
    if (upload?.ownerId !== user.id) {
      throw notFound('Upload not found');
    }
    if (upload.purpose !== 'portfolio') {
      throw new HttpException(
        { code: 'UNPROCESSABLE_ENTITY', message: 'Upload purpose must be "portfolio"' },
        422,
      );
    }
    if (!isAttachableUploadStatus(upload.status)) {
      throw new HttpException(
        { code: 'UNPROCESSABLE_ENTITY', message: 'Upload is not usable' },
        422,
      );
    }

    const alreadyAttached = await this.prisma.client.portfolioImage.findUnique({
      where: { uploadId },
    });
    if (alreadyAttached) {
      throw new HttpException(
        { code: 'CONFLICT', message: 'Upload is already attached to a portfolio image' },
        409,
      );
    }

    const { _max } = await this.prisma.client.portfolioImage.aggregate({
      where: { profileId: profile.id },
      _max: { order: true },
    });
    const order = (_max.order ?? 0) + 1;

    // The worker's image-process job only flips a `processing` image to
    // `pending_review` when it finishes (apps/worker's image-process
    // processor); if the upload already finished processing before this
    // attach call, that transition already happened against no row and
    // never fires again, so it is applied here instead.
    const alreadyProcessed = upload.status === 'processed';
    const created = await this.prisma.client.portfolioImage.create({
      data: {
        profileId: profile.id,
        uploadId,
        order,
        width: alreadyProcessed ? upload.width : null,
        height: alreadyProcessed ? upload.height : null,
        status: alreadyProcessed ? 'pending_review' : 'processing',
      },
      include: { upload: true },
    });

    return mapPortfolioImage(created, created.upload, this.baseUrl);
  }

  async reorder(user: SessionUser, imageIds: readonly string[]): Promise<PortfolioImageDto[]> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);

    const existing = await this.prisma.client.portfolioImage.findMany({
      where: { profileId: profile.id, deletedAt: null },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((image) => image.id));
    const requestedIds = new Set(imageIds);

    const isExactMatch =
      existingIds.size === requestedIds.size &&
      [...existingIds].every((id) => requestedIds.has(id));
    if (!isExactMatch) {
      throw new HttpException(
        {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'imageIds must exactly match the owner non-deleted portfolio images',
        },
        422,
      );
    }

    await this.prisma.client.$transaction(
      imageIds.map((id, index) =>
        this.prisma.client.portfolioImage.update({ where: { id }, data: { order: index + 1 } }),
      ),
    );

    const updated = await this.prisma.client.portfolioImage.findMany({
      where: { profileId: profile.id, deletedAt: null },
      orderBy: { order: 'asc' },
      include: { upload: true },
    });

    return updated.map((image) => mapPortfolioImage(image, image.upload, this.baseUrl));
  }

  async delete(user: SessionUser, imageId: string): Promise<void> {
    requireRole(user, 'photographer');
    const profile = await this.profiles.getOwnProfileRecord(user.id);

    const image = await this.prisma.client.portfolioImage.findUnique({
      where: { id: imageId },
      include: { upload: true },
    });
    if (!image || image.deletedAt) {
      throw notFound('Portfolio image not found');
    }
    if (image.profileId !== profile.id) {
      throw notFound('Portfolio image not found');
    }

    await this.prisma.client.portfolioImage.update({
      where: { id: imageId },
      data: { deletedAt: new Date() },
    });

    const variants = image.upload.variants as Record<string, string> | null;
    const variantKeys = variants ? Object.values(variants) : [];
    if (variantKeys.length > 0) {
      await this.cleanupQueue.enqueue({ uploadId: image.uploadId, variantKeys });
    }
  }
}
