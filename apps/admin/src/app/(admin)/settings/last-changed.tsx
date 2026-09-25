import { getFormatter, getTranslations } from 'next-intl/server';

import { serverApi } from '@/lib/server-api';

export async function LastChanged({
  entityType,
  targetId,
}: {
  entityType: string;
  targetId?: string;
}) {
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/admin/audit-log', {
    params: { query: { entityType, ...(targetId ? { targetId } : {}), limit: 1 } },
  });
  if (!data) {
    throw new Error(
      `Failed to load audit log for ${entityType}${targetId ? `/${targetId}` : ''}: HTTP ${String(response.status)}`,
    );
  }

  const t = await getTranslations('admin.settings.lastChanged');
  const format = await getFormatter();
  const entry = data.items[0];

  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t('label')}</span>{' '}
      {entry
        ? entry.actorId
          ? t('by', {
              actorId: entry.actorId,
              date: format.dateTime(new Date(entry.occurredAt), 'medium'),
            })
          : t('bySystem', { date: format.dateTime(new Date(entry.occurredAt), 'medium') })
        : t('never')}
    </p>
  );
}
