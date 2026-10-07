import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';

import { MAX_MESSAGE_BODY_LENGTH } from '@photoo/shared';

import { openAppSettings, pickAttachments, type PickSource } from '../../lib/attachment-pickers';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '../../lib/chat-attachments';
import { useAttachmentDrafts, type DraftNotice } from '../../lib/use-attachment-drafts';
import type { SendMessageInput, SendMessageResult } from '../../lib/use-conversation';
import { PrimaryButton } from '../form/primary-button';
import { AttachmentDraftList } from './attachment-draft-list';

type Denied = 'camera' | 'library';

function noticeMessage(t: ReturnType<typeof useTranslation>['t'], notice: DraftNotice): string {
  if (notice.kind === 'tooManyFiles') {
    return t('mobile.chat.attachments.tooManyFiles', { max: MAX_ATTACHMENTS });
  }
  if (notice.kind === 'tooLarge') {
    return t('mobile.chat.attachments.tooLarge', {
      name: notice.name,
      limit: Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024)),
    });
  }
  return t('mobile.chat.attachments.unsupportedType', { name: notice.name });
}

const SOURCES: { source: PickSource; labelKey: string }[] = [
  { source: 'camera', labelKey: 'mobile.chat.attachments.camera' },
  { source: 'library', labelKey: 'mobile.chat.attachments.library' },
  { source: 'files', labelKey: 'mobile.chat.attachments.files' },
];

export function MessageComposer({
  onSend,
  onTyping,
}: {
  onSend: (input: SendMessageInput) => Promise<SendMessageResult>;
  onTyping: (isTyping: boolean) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [denied, setDenied] = useState<Denied | null>(null);
  const textRef = useRef('');
  const drafts = useAttachmentDrafts();

  function update(next: string) {
    textRef.current = next;
    setText(next);
    setInvalid(false);
    onTyping(next.length > 0);
  }

  async function pick(source: PickSource) {
    setMenuOpen(false);
    setDenied(null);
    const result = await pickAttachments(source, MAX_ATTACHMENTS - drafts.drafts.length);
    if (result.status === 'denied' && source !== 'files') {
      setDenied(source);
    } else if (result.status === 'picked') {
      drafts.add(result.files);
    }
  }

  function submit() {
    const body = textRef.current;
    const hasBody = body.trim().length > 0;
    const attachments = drafts.take();
    if (!attachments || (!hasBody && attachments.length === 0)) {
      return;
    }
    textRef.current = '';
    setText('');
    void onSend({ body, attachments }).then((result) => {
      if (!result.ok && result.kind === 'invalid') {
        textRef.current = body;
        setText(body);
        drafts.restore(attachments);
        setInvalid(true);
      }
    });
  }

  const canSend = !drafts.blocked && (text.trim().length > 0 || drafts.readyCount > 0);
  const atLimit = drafts.drafts.length >= MAX_ATTACHMENTS;

  return (
    <View className="gap-1 border-t border-border bg-background px-4 py-2">
      {invalid ? (
        <Text
          className="text-sm text-destructive"
          accessibilityRole="alert"
          testID="composer-invalid"
        >
          {t('mobile.chat.errors.invalidBody')}
        </Text>
      ) : null}
      {drafts.notice ? (
        <Text
          className="text-sm text-destructive"
          accessibilityRole="alert"
          testID="composer-attachment-notice"
        >
          {noticeMessage(t, drafts.notice)}
        </Text>
      ) : null}
      {denied ? (
        <View className="gap-1" accessibilityRole="alert" testID="composer-permission-denied">
          <Text className="text-sm text-muted-foreground">
            {denied === 'camera'
              ? t('mobile.chat.attachments.cameraDenied')
              : t('mobile.chat.attachments.libraryDenied')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void openAppSettings()}
            testID="composer-open-settings"
            className="min-h-11 justify-center"
          >
            <Text className="text-sm font-medium text-foreground underline">
              {t('mobile.chat.attachments.openSettings')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {drafts.drafts.length > 0 ? (
        <AttachmentDraftList
          drafts={drafts.drafts}
          onRemove={drafts.remove}
          onRetry={drafts.retry}
        />
      ) : null}
      {menuOpen ? (
        <View className="flex-row flex-wrap gap-2" testID="attach-menu">
          {SOURCES.map(({ source, labelKey }) => (
            <Pressable
              key={source}
              accessibilityRole="button"
              onPress={() => void pick(source)}
              testID={`attach-${source}`}
              className="min-h-11 justify-center rounded-md border border-input px-3"
            >
              <Text className="text-sm text-foreground">{t(labelKey)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {drafts.inFlight ? (
        <Text className="text-xs text-muted-foreground" testID="composer-wait-uploads">
          {t('mobile.chat.attachments.waitForUploads')}
        </Text>
      ) : null}
      <View className="flex-row items-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.chat.attachments.attachCta')}
          accessibilityState={{ disabled: atLimit, expanded: menuOpen }}
          disabled={atLimit}
          onPress={() => {
            setMenuOpen((open) => !open);
          }}
          testID="composer-attach"
          className={`min-h-11 min-w-11 items-center justify-center rounded-md border border-input ${atLimit ? 'opacity-50' : ''}`}
        >
          <Text className="text-xl text-foreground">+</Text>
        </Pressable>
        <TextInput
          className="max-h-32 min-h-11 flex-1 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground"
          placeholderTextColor="#a3a3a3"
          placeholder={t('mobile.chat.composer.placeholder')}
          accessibilityLabel={t('mobile.chat.composer.label')}
          value={text}
          onChangeText={update}
          multiline
          maxLength={MAX_MESSAGE_BODY_LENGTH + 1}
          testID="composer-input"
        />
        <PrimaryButton
          label={t('mobile.chat.composer.sendCta')}
          onPress={submit}
          disabled={!canSend}
          testID="composer-send"
        />
      </View>
    </View>
  );
}
