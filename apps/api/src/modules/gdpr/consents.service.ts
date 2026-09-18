import { HttpException, Inject, Injectable } from '@nestjs/common';
import type {
  ConsentRecordSchema,
  ConsentsResponseSchema,
  CreateConsentRequestSchema,
  UpdateConsentsRequestSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { buildConsentMatrix, mapConsentRecord } from './consent-mapper.js';

type UpdateConsentsInput = z.infer<typeof UpdateConsentsRequestSchema>;
type CreateConsentInput = z.infer<typeof CreateConsentRequestSchema>;
type ConsentsResponse = z.infer<typeof ConsentsResponseSchema>;
type ConsentRecordDto = z.infer<typeof ConsentRecordSchema>;

interface SessionUser {
  id: string;
}

@Injectable()
export class ConsentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getState(user: SessionUser): Promise<ConsentsResponse> {
    const records = await this.prisma.client.consentRecord.findMany({
      where: { userId: user.id },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: { purpose: true, granted: true, policyVersion: true, recordedAt: true },
    });
    return { consents: buildConsentMatrix(records) };
  }

  async updateForUser(
    user: SessionUser,
    input: UpdateConsentsInput,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<ConsentsResponse> {
    const policyVersion = await this.getPolicyVersion();
    await this.prisma.client.consentRecord.createMany({
      data: input.consents.map((entry) => ({
        userId: user.id,
        purpose: entry.purpose,
        granted: entry.granted,
        policyVersion,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      })),
    });
    return this.getState(user);
  }

  // `session` wins over a client-supplied `anonymousId`: a signed-in caller
  // records against their own account, never against an id they happen to
  // pass, so this can't be used to attach a decision to someone else's
  // anonymous trail.
  async record(
    input: CreateConsentInput,
    session: SessionUser | null,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<ConsentRecordDto> {
    const policyVersion = await this.getPolicyVersion();

    if (session) {
      const record = await this.prisma.client.consentRecord.create({
        data: {
          userId: session.id,
          purpose: input.purpose,
          granted: input.granted,
          policyVersion,
          ip: ip ?? null,
          userAgent: userAgent ?? null,
        },
      });
      return mapConsentRecord(record);
    }

    if (!input.anonymousId) {
      throw new HttpException(
        { code: 'VALIDATION_ERROR', message: 'anonymousId is required when signed out' },
        400,
      );
    }

    const record = await this.prisma.client.consentRecord.create({
      data: {
        anonymousId: input.anonymousId,
        purpose: input.purpose,
        granted: input.granted,
        policyVersion,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
    return mapConsentRecord(record);
  }

  // No fallback: a `ConsentRecord` is legal evidence of what someone agreed
  // to, and writing a made-up `policyVersion` when none is configured would
  // fabricate the fact the record exists to prove, invisibly. `policyVersion`
  // starts null and only gets a real value once a legal text is first
  // published (1D.7a, PR #226: `Country.legalTexts`/`admin-countries.service.ts`
  // bumps it on publish) - so a missing value is a launch-ordering gap
  // (nothing has been published yet), not a bug, but the write must still
  // fail loudly rather than invent a version nobody agreed to. This throws
  // a plain `Error` (mapped to 500 by AllExceptionsFilter, message logged
  // server-side and not echoed to the client) rather than a client-facing
  // validation error, matching quotes.service.ts's `getFeePercent`.
  //
  // TODO(#226): this duplicates the read `CountriesService.getPolicyVersion()`
  // owns on `feat/1D.7a-settings-api`. That branch isn't in `dev` yet, so
  // there is nothing to inject here without depending on unmerged code;
  // once it lands, replace this direct query with a call to that reader
  // instead of keeping a second one.
  private async getPolicyVersion(): Promise<string> {
    const setting = await this.prisma.client.platformSetting.findUnique({
      where: { key: 'policyVersion' },
    });
    const value = setting?.value;
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        'consents: PlatformSetting "policyVersion" is missing or invalid - publish a legal ' +
          'text version before consent can be recorded',
      );
    }
    return value;
  }
}
