export const SLUG_MAX_LENGTH = 60;
const DEFAULT_MIN_LENGTH = 3;
const DEFAULT_FALLBACK = 'photographer';

export interface SlugifyOptions {
  maxLength?: number;
  minLength?: number;
  fallback?: string;
}

export function slugify(value: string, options: SlugifyOptions = {}): string {
  const maxLength = options.maxLength ?? SLUG_MAX_LENGTH;
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
  const fallback = options.fallback ?? DEFAULT_FALLBACK;

  const base = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

  return base.length >= minLength ? base : fallback;
}
