import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput, View } from 'react-native';

import { MAX_MESSAGE_BODY_LENGTH } from '@photoo/shared';

import { PrimaryButton } from '../form/primary-button';
import type { SendMessageResult } from '../../lib/use-conversation';

export function MessageComposer({
  onSend,
  onTyping,
}: {
  onSend: (body: string) => Promise<SendMessageResult>;
  onTyping: (isTyping: boolean) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const textRef = useRef('');

  function update(next: string) {
    textRef.current = next;
    setText(next);
    setInvalid(false);
    onTyping(next.length > 0);
  }

  function submit() {
    const body = textRef.current;
    if (body.trim().length === 0) {
      return;
    }
    textRef.current = '';
    setText('');
    void onSend(body).then((result) => {
      if (!result.ok && result.kind === 'invalid') {
        textRef.current = body;
        setText(body);
        setInvalid(true);
      }
    });
  }

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
      <View className="flex-row items-end gap-2">
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
          disabled={text.trim().length === 0}
          testID="composer-send"
        />
      </View>
    </View>
  );
}
