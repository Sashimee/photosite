import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { AttachmentDraft } from '../../lib/use-attachment-drafts';

function statusLabel(t: ReturnType<typeof useTranslation>['t'], draft: AttachmentDraft): string {
  switch (draft.status) {
    case 'uploading':
      return t('mobile.chat.attachments.uploading', { percent: draft.percent });
    case 'scanning':
      return t('mobile.chat.attachments.scanning');
    case 'ready':
      return t('mobile.chat.attachments.ready');
    case 'failed':
      if (draft.failure === 'infected') {
        return t('mobile.chat.attachments.infected');
      }
      if (draft.failure === 'scanTimeout') {
        return t('mobile.chat.attachments.scanTimeout');
      }
      return t('mobile.chat.attachments.uploadFailed');
  }
}

export function AttachmentDraftList({
  drafts,
  onRemove,
  onRetry,
}: {
  drafts: AttachmentDraft[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="gap-1" testID="attachment-drafts">
      {drafts.map((draft) => (
        <View
          key={draft.key}
          className="flex-row items-center gap-2 rounded-md border border-border px-3"
          testID={`draft-${draft.key}`}
        >
          <View className="flex-1 gap-1 py-2">
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {draft.name}
            </Text>
            <Text
              className={`text-xs ${draft.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
              accessibilityRole={draft.status === 'failed' ? 'alert' : undefined}
              testID={`draft-status-${draft.key}`}
            >
              {statusLabel(t, draft)}
            </Text>
            {draft.status === 'uploading' ? (
              <View
                className="h-1 flex-row overflow-hidden rounded bg-muted"
                testID={`draft-progress-${draft.key}`}
              >
                <View className="h-1 bg-primary" style={{ flex: draft.percent }} />
                <View style={{ flex: 100 - draft.percent }} />
              </View>
            ) : null}
          </View>
          {draft.status === 'failed' && draft.failure !== 'infected' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onRetry(draft.key);
              }}
              testID={`draft-retry-${draft.key}`}
              className="min-h-11 justify-center"
            >
              <Text className="text-xs font-medium text-foreground underline">
                {t('mobile.chat.attachments.retryCta')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.chat.attachments.removeCta', { name: draft.name })}
            onPress={() => {
              onRemove(draft.key);
            }}
            testID={`draft-remove-${draft.key}`}
            className="min-h-11 min-w-11 items-center justify-center"
          >
            <Text className="text-base text-foreground">×</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
