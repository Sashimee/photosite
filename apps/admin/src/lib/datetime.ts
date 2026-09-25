import type { Formats } from 'next-intl';

export const ADMIN_TIME_ZONE = 'Europe/Luxembourg';

export const ADMIN_FORMATS = {
  dateTime: {
    medium: {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    },
  },
} satisfies Formats;
