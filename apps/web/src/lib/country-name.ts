import type { Locale } from '@photoo/shared';

export function countryDisplayName(countryCode: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(countryCode) ?? countryCode;
  } catch (error) {
    if (error instanceof RangeError) {
      return countryCode;
    }
    throw error;
  }
}
