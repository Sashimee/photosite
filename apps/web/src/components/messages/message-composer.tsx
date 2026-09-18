'use client';

import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requestErrorMessage } from '@/lib/request-errors';
import type {
  PendingAttachment,
  SendMessageInput,
  SendMessageResult,
} from '@/lib/use-conversation';

import { AttachmentPicker } from './attachment-picker';

export function MessageComposer({
  onSend,
  onTyping,
}: {
  onSend: (input: SendMessageInput) => Promise<SendMessageResult>;
  onTyping: (isTyping: boolean) => void;
}) {
  const t = useTranslations('web.messages.composer');
  const tErrors = useTranslations('web.messages');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const canSend =
    !sending && !attachmentsBusy && (body.trim().length > 0 || attachments.length > 0);

  async function submit() {
    if (!canSend) {
      return;
    }
    setSending(true);
    setError(null);
    onTyping(false);
    const result = await onSend({ body: body.trim() || undefined, attachments });
    setSending(false);
    if (!result.ok) {
      setError(requestErrorMessage(tErrors, result.error));
      return;
    }
    setBody('');
    setResetKey((previous) => previous + 1);
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error ? <FormNotice tone="error">{error}</FormNotice> : null}
      <Label htmlFor="message-composer-body" className="sr-only">
        {t('bodyLabel')}
      </Label>
      <Textarea
        id="message-composer-body"
        value={body}
        placeholder={t('placeholder')}
        rows={2}
        onChange={(event) => {
          setBody(event.target.value);
          onTyping(event.target.value.length > 0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <AttachmentPicker
        resetKey={resetKey}
        onChange={(ready, busy) => {
          setAttachments(ready);
          setAttachmentsBusy(busy);
        }}
      />
      {attachmentsBusy ? (
        <p className="text-xs text-muted-foreground">{t('uploadingHint')}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSend} aria-busy={sending} className="gap-2">
          <Send aria-hidden="true" />
          {t('sendCta')}
        </Button>
      </div>
    </form>
  );
}
