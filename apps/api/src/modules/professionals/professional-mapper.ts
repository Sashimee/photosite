import type { ProfessionalProfile, Upload } from '@photoo/db';
import { OwnProfessionalProfileSchema, PublicProfessionalCompanySchema } from '@photoo/shared';
import type { z } from 'zod';
import { publicVariantUrl } from '../../storage/public-url.js';

const LOGO_VARIANT_KEY = 'thumb_jpeg';

export interface ProfessionalProfileWithLogo extends ProfessionalProfile {
  logoUpload: Upload | null;
}

export interface ProfessionalCompanyRow {
  id: string;
  companyName: string;
  website: string | null;
  logoVariants: Record<string, string> | null;
  verified: boolean;
}

export function mapOwnProfile(
  profile: ProfessionalProfileWithLogo,
  baseUrl: string,
): z.infer<typeof OwnProfessionalProfileSchema> {
  return OwnProfessionalProfileSchema.parse({
    id: profile.id,
    companyName: profile.companyName,
    website: profile.website,
    logoUrl: publicVariantUrl(
      baseUrl,
      (profile.logoUpload?.variants as Record<string, string> | null | undefined) ?? null,
      LOGO_VARIANT_KEY,
    ),
    verified: profile.verified,
    vatNumber: profile.vatNumber,
  });
}

export function mapPublicCompany(
  row: ProfessionalCompanyRow,
  baseUrl: string,
): z.infer<typeof PublicProfessionalCompanySchema> {
  return PublicProfessionalCompanySchema.parse({
    id: row.id,
    companyName: row.companyName,
    website: row.website,
    logoUrl: publicVariantUrl(baseUrl, row.logoVariants, LOGO_VARIANT_KEY),
    verified: row.verified,
  });
}
