import { DIRECT_TAKEDOWN_TARGET_TYPES } from '@photoo/shared';

export type RawDirectTakedownSearchParams = Record<string, string | string[] | undefined>;

export type DirectTakedownTargetType = (typeof DIRECT_TAKEDOWN_TARGET_TYPES)[number];

export interface DirectTakedownSearchParams {
  targetType: DirectTakedownTargetType;
  slug?: string;
}

const DEFAULT_TARGET_TYPE: DirectTakedownTargetType = 'photographer_profile';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isDirectTakedownTargetType(value: string): value is DirectTakedownTargetType {
  return (DIRECT_TAKEDOWN_TARGET_TYPES as readonly string[]).includes(value);
}

// A moderator's only entry point is the slug they saw on the public site
// (docs/steps/1D.6-moderation.md 1D.6c: neither `photographer_profile` nor
// `job_offer` has an admin browsing screen), so this is a lookup, not a
// filtered list: the target type picks which public endpoint resolves the
// slug to the id the API's direct-takedown route requires.
export function parseDirectTakedownSearchParams(
  raw: RawDirectTakedownSearchParams,
): DirectTakedownSearchParams {
  const rawTargetType = first(raw.targetType);
  const targetType =
    rawTargetType && isDirectTakedownTargetType(rawTargetType)
      ? rawTargetType
      : DEFAULT_TARGET_TYPE;
  const rawSlug = first(raw.slug)?.trim();

  return {
    targetType,
    ...(rawSlug ? { slug: rawSlug } : {}),
  };
}
