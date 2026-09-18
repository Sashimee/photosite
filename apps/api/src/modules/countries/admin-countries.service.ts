import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Country } from '@photoo/db';
import {
  AdminCountrySchema,
  AdminLegalTextVersionSchema,
  type PublishLegalTextRequestSchema,
  type UpdateCountryRequestSchema,
} from '@photoo/shared';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { CountriesRepository } from './countries.repository.js';

type AdminCountry = z.infer<typeof AdminCountrySchema>;
type UpdateInput = z.infer<typeof UpdateCountryRequestSchema>;
type PublishLegalTextInput = z.infer<typeof PublishLegalTextRequestSchema>;
type LegalTextVersion = z.infer<typeof AdminLegalTextVersionSchema>;

interface AdminActor {
  id: string;
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Country not found' }, 404);
}

function mapAdminCountry(country: Country, accountCount: number): AdminCountry {
  return AdminCountrySchema.parse({
    code: country.code,
    name: country.name,
    enabled: country.enabled,
    currency: country.currency,
    vatRate: country.vatRate.toNumber(),
    defaultLocale: country.defaultLocale,
    accountCount,
  });
}

const LegalTextsSchema = z.object({ versions: z.array(AdminLegalTextVersionSchema) });

function parseLegalTextVersions(value: unknown): LegalTextVersion[] {
  const result = LegalTextsSchema.safeParse(value);
  return result.success ? result.data.versions : [];
}

@Injectable()
export class AdminCountriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CountriesRepository) private readonly repository: CountriesRepository,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
  ) {}

  async list(): Promise<AdminCountry[]> {
    const rows = await this.repository.listAllWithAccountCounts();
    return rows.map(({ country, accountCount }) => mapAdminCountry(country, accountCount));
  }

  async update(
    admin: AdminActor,
    code: string,
    changes: UpdateInput,
    ip: string | undefined,
  ): Promise<AdminCountry> {
    const existing = await this.repository.findByCode(code);
    if (!existing) {
      throw notFound();
    }

    const before = {
      enabled: existing.enabled,
      vatRate: existing.vatRate.toNumber(),
      defaultLocale: existing.defaultLocale,
    };
    const after = {
      enabled: changes.enabled ?? before.enabled,
      vatRate: changes.vatRate ?? before.vatRate,
      defaultLocale: changes.defaultLocale ?? before.defaultLocale,
    };

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await this.repository.update(tx, code, after);
      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'country.updated',
        targetType: 'Country',
        targetId: code,
        before,
        after,
        ip: ip ?? null,
      });
      return row;
    });

    const accountCount = await this.repository.countAccounts(code);
    return mapAdminCountry(updated, accountCount);
  }

  async getLegalTexts(
    code: string,
  ): Promise<{ countryCode: string; versions: LegalTextVersion[] }> {
    const country = await this.repository.findByCode(code);
    if (!country) {
      throw notFound();
    }
    return { countryCode: code, versions: parseLegalTextVersions(country.legalTexts) };
  }

  // Append-only: the existing versions are read back and kept, never
  // replaced, so a published version - which `ConsentRecord.policyVersion`
  // may already point at - can never be edited out from under a consent
  // record (docs/steps/1D.7-settings.md).
  async publishLegalText(
    admin: AdminActor,
    code: string,
    input: PublishLegalTextInput,
    ip: string | undefined,
  ): Promise<{ countryCode: string; versions: LegalTextVersion[] }> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const country = await tx.country.findUnique({ where: { code } });
      if (!country) {
        throw notFound();
      }
      const existingVersions = parseLegalTextVersions(country.legalTexts);
      const newEntry: LegalTextVersion = {
        version: String(existingVersions.length + 1),
        kind: input.kind,
        locale: input.locale,
        content: input.content,
        publishedAt: new Date().toISOString(),
        publishedByAdminId: admin.id,
      };
      const versions = [...existingVersions, newEntry];

      const policySetting = await tx.platformSetting.findUnique({
        where: { key: 'policyVersion' },
      });
      const currentPolicyVersion =
        typeof policySetting?.value === 'string' ? Number.parseInt(policySetting.value, 10) : 0;
      const nextPolicyVersion = String(
        Number.isFinite(currentPolicyVersion) && currentPolicyVersion > 0
          ? currentPolicyVersion + 1
          : 1,
      );

      await tx.country.update({ where: { code }, data: { legalTexts: { versions } } });
      await tx.platformSetting.upsert({
        where: { key: 'policyVersion' },
        create: { key: 'policyVersion', value: nextPolicyVersion, updatedByAdminId: admin.id },
        update: { value: nextPolicyVersion, updatedByAdminId: admin.id },
      });

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'country.legal_text_published',
        targetType: 'Country',
        targetId: code,
        before: { versionCount: existingVersions.length },
        after: { version: newEntry.version, kind: newEntry.kind, locale: newEntry.locale },
        ip: ip ?? null,
      });

      return { countryCode: code, versions };
    });

    return result;
  }
}
