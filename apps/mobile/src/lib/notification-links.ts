import { IdSchema, SUPPORTED_LOCALES } from '@photoo/shared';

const CONVERSATION_URL = new RegExp(`^/(?:${SUPPORTED_LOCALES.join('|')})/messages/([^/?#]+)$`);

export function conversationHrefFromPushData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('url' in data)) {
    return null;
  }
  const { url } = data;
  if (typeof url !== 'string') {
    return null;
  }
  const id = CONVERSATION_URL.exec(url)?.[1];
  const parsed = IdSchema.safeParse(id);
  return parsed.success ? `/messages/${parsed.data}` : null;
}
