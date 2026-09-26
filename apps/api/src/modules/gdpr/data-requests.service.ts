import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import {
  GDPR_DELETION_GRACE_PERIOD_MS,
  type CreateDataRequestRequestSchema,
  type DataRequestSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { ChatSocketBridge } from '../chat/chat-socket-bridge.js';
import { EmailQueueService } from '../auth/mailer/email-queue.service.js';
import { applyAccountDeletion } from './apply-account-deletion.js';
import { assertNoBlockingObligations } from './blocking-obligations.js';
import { DataRequestsRateLimitService } from './data-requests-rate-limit.service.js';
import { mapDataRequest } from './data-request-mapper.js';
import { signDeletionCancelToken, verifyDeletionCancelToken } from './deletion-cancel-token.js';
import { GdprExportQueueService } from './gdpr-export-queue.service.js';

type CreateInput = z.infer<typeof CreateDataRequestRequestSchema>;
type DataRequestDto = z.infer<typeof DataRequestSchema>;

const DOWNLOAD_URL_EXPIRY_SECONDS = 10 * 60;
const OPEN_STATUSES = ['pending', 'processing'] as const;

interface SessionUser {
  id: string;
  email: string;
}

interface CreateResult {
  status: 200 | 201;
  data: DataRequestDto;
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Data request not found' }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function forbidden(message: string): HttpException {
  return new HttpException({ code: 'FORBIDDEN', message }, 403);
}

function gone(message: string): HttpException {
  return new HttpException({ code: 'GONE', message }, 410);
}

function unauthorized(): HttpException {
  return new HttpException({ code: 'UNAUTHORIZED', message: 'Sign in required' }, 401);
}

@Injectable()
export class DataRequestsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ChatSocketBridge) private readonly chatSocketBridge: ChatSocketBridge,
    @Inject(EmailQueueService) private readonly emailQueue: EmailQueueService,
    @Inject(GdprExportQueueService) private readonly exportQueue: GdprExportQueueService,
    @Inject(DataRequestsRateLimitService) private readonly rateLimit: DataRequestsRateLimitService,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  async create(
    user: SessionUser,
    input: CreateInput,
    ip: string | undefined,
  ): Promise<CreateResult> {
    if (input.type === 'export') {
      return this.createExport(user);
    }
    return this.createDeletion(user, ip);
  }

  async list(user: SessionUser): Promise<DataRequestDto[]> {
    const rows = await this.prisma.client.dataRequest.findMany({
      where: { userId: user.id },
      orderBy: { requestedAt: 'desc' },
    });
    return rows.map(mapDataRequest);
  }

  async get(user: SessionUser, id: string): Promise<DataRequestDto> {
    const row = await this.prisma.client.dataRequest.findUnique({ where: { id } });
    if (row?.userId !== user.id) {
      throw notFound();
    }
    return mapDataRequest(row);
  }

  // A soft-deleted account has no session, so `session` is whatever the
  // caller could still present (usually null) and `token` is the value
  // mailed at deletion time (docs/steps/1A.12-gdpr.md "Cancellable during
  // the grace period"). No credential at all is 401; a credential that
  // resolves to someone else's row is 404, matching how every other
  // ownership check in this codebase avoids confirming the row exists.
  async cancel(
    id: string,
    session: SessionUser | null,
    token: string | undefined,
  ): Promise<DataRequestDto> {
    const row = await this.prisma.client.dataRequest.findUnique({ where: { id } });
    if (!row) {
      throw notFound();
    }

    let callerId: string | null = null;
    if (session) {
      callerId = session.id;
    } else if (token) {
      callerId = verifyDeletionCancelToken(this.config.AUTH_SECRET, row.id, row.userId, token)
        ? row.userId
        : null;
    }

    if (callerId === null) {
      throw unauthorized();
    }
    if (callerId !== row.userId) {
      throw notFound();
    }
    if (row.type !== 'delete') {
      throw conflict('Only a deletion request can be cancelled');
    }

    const cancelled = await this.prisma.client.$transaction(async (tx) => {
      const cutoff = new Date(Date.now() - GDPR_DELETION_GRACE_PERIOD_MS);
      const guarded = await tx.dataRequest.updateMany({
        where: { id, status: 'pending', requestedAt: { gt: cutoff } },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      if (guarded.count === 0) {
        if (row.status === 'pending' && row.requestedAt.getTime() <= cutoff.getTime()) {
          throw conflict('Deletion grace period has ended; the request can no longer be cancelled');
        }
        throw conflict('Data request is no longer pending');
      }

      // The deletion's own audit row is the only record of whether the
      // photographer profile was published before it got unpublished;
      // restoring blindly to `true` would re-publish a profile the
      // photographer had already taken down themselves.
      const deletionLog = await tx.auditLog.findFirst({
        where: {
          targetType: 'DataRequest',
          targetId: id,
          action: 'data_request.deletion_requested',
        },
        orderBy: { occurredAt: 'desc' },
      });
      const before = deletionLog?.before as { profileIsPublished?: boolean | null } | null;

      await tx.user.updateMany({
        where: { id: row.userId, status: 'deleted' },
        data: { status: 'active', deletedAt: null },
      });

      if (before?.profileIsPublished) {
        await tx.photographerProfile.updateMany({
          where: { userId: row.userId },
          data: { isPublished: true },
        });
      }

      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: row.userId,
          action: 'data_request.cancelled',
          targetType: 'DataRequest',
          targetId: id,
          before: { status: 'pending' },
          after: { status: 'cancelled', restoredIsPublished: Boolean(before?.profileIsPublished) },
        },
      });

      return tx.dataRequest.findUniqueOrThrow({ where: { id } });
    });

    return mapDataRequest(cancelled);
  }

  async download(user: SessionUser, id: string): Promise<{ url: string; expiresAt: string }> {
    const row = await this.prisma.client.dataRequest.findUnique({ where: { id } });
    if (!row) {
      throw notFound();
    }
    if (row.userId !== user.id) {
      throw forbidden('This data request belongs to another account');
    }
    if (row.type !== 'export') {
      throw conflict('Only an export request can be downloaded');
    }
    if (row.status !== 'ready' || !row.exportKey || !row.expiresAt) {
      throw conflict('This export is not ready yet');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw gone('This download link has expired');
    }

    const url = await this.storage.presignGet({
      bucket: this.storage.config.privateBucket,
      key: row.exportKey,
      expiresInSeconds: DOWNLOAD_URL_EXPIRY_SECONDS,
      responseContentType: 'application/zip',
      responseContentDisposition: 'attachment; filename="export.zip"',
    });

    // The presigned URL itself is never written here or anywhere else
    // (docs/steps/1A.12-gdpr.md "the presigned URL is never logged").
    await this.prisma.client.auditLog.create({
      data: {
        actorType: 'user',
        actorId: user.id,
        action: 'data_request.download_issued',
        targetType: 'DataRequest',
        targetId: id,
      },
    });

    return { url, expiresAt: row.expiresAt.toISOString() };
  }

  private async createExport(user: SessionUser): Promise<CreateResult> {
    const existing = await this.prisma.client.dataRequest.findFirst({
      where: { userId: user.id, type: 'export', status: { in: [...OPEN_STATUSES] } },
    });
    if (existing) {
      return { status: 200, data: mapDataRequest(existing) };
    }

    await this.rateLimit.enforceExportCreate(user.id);

    let created;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.dataRequest.create({
          data: { userId: user.id, type: 'export', status: 'pending' },
        });
        await tx.auditLog.create({
          data: {
            actorType: 'user',
            actorId: user.id,
            action: 'data_request.export_requested',
            targetType: 'DataRequest',
            targetId: row.id,
            after: { type: 'export', status: 'pending' },
          },
        });
        return row;
      });
    } catch (error) {
      const raced = await this.findRacedOpenRequest(error, user.id, 'export');
      if (raced) {
        return { status: 200, data: mapDataRequest(raced) };
      }
      throw error;
    }

    await this.exportQueue.enqueue(created.id);
    return { status: 201, data: mapDataRequest(created) };
  }

  private async createDeletion(user: SessionUser, ip: string | undefined): Promise<CreateResult> {
    const existing = await this.prisma.client.dataRequest.findFirst({
      where: { userId: user.id, type: 'delete', status: { in: [...OPEN_STATUSES] } },
    });
    if (existing) {
      return { status: 200, data: mapDataRequest(existing) };
    }

    await assertNoBlockingObligations(this.prisma.client, user.id);

    let created;
    const requestedAt = new Date();
    try {
      created = await this.prisma.client.$transaction((tx) =>
        applyAccountDeletion(tx, {
          userId: user.id,
          requestedAt,
          receivedAt: requestedAt,
          channel: 'in_app',
          audit: {
            actorType: 'user',
            actorId: user.id,
            action: 'data_request.deletion_requested',
            ip: ip ?? null,
          },
        }),
      );
    } catch (error) {
      const raced = await this.findRacedOpenRequest(error, user.id, 'delete');
      if (raced) {
        return { status: 200, data: mapDataRequest(raced) };
      }
      throw error;
    }

    await this.runPostDeletionSideEffects(user, created.id);

    return { status: 201, data: mapDataRequest(created) };
  }

  async runPostDeletionSideEffects(user: SessionUser, dataRequestId: string): Promise<void> {
    this.chatSocketBridge.disconnectUser(user.id);
    await this.sendDeletionEmail(user.email, dataRequestId, user.id);
  }

  private async findRacedOpenRequest(error: unknown, userId: string, type: 'export' | 'delete') {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return null;
    }
    return this.prisma.client.dataRequest.findFirst({
      where: { userId, type, status: { in: [...OPEN_STATUSES] } },
    });
  }

  private async sendDeletionEmail(
    email: string,
    dataRequestId: string,
    userId: string,
  ): Promise<void> {
    const token = signDeletionCancelToken(this.config.AUTH_SECRET, dataRequestId, userId);
    const url = `${this.config.WEB_APP_URL}/account/deletion/cancel/${dataRequestId}#token=${encodeURIComponent(token)}`;
    await this.emailQueue.enqueue({ type: 'account-deletion-requested', to: email, url });
  }
}
