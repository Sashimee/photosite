import type { PrismaClient } from '@photoo/db';

// Unlike apps/api's consents.service.ts (where a missing policyVersion must
// fail loudly because a ConsentRecord is legal evidence of what someone
// agreed to), a GDPR export is a right the subject already has regardless
// of whether a privacy policy text has been published yet: a missing
// setting here is recorded as `null` in the manifest instead of failing the
// whole export.
export async function readPolicyVersion(prisma: PrismaClient): Promise<string | null> {
  const setting = await prisma.platformSetting.findUnique({ where: { key: 'policyVersion' } });
  const value = setting?.value;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
