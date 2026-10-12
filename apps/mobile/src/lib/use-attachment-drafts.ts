import { useCallback, useRef, useState } from 'react';

import {
  AttachmentRejectedError,
  ChatUploadError,
  MAX_ATTACHMENTS,
  prepareFile,
  uploadChatAttachment,
  type ChatUploadErrorKind,
  type PendingAttachment,
  type PickedFile,
  type PreparedFile,
} from './chat-attachments';

export type DraftStatus = 'uploading' | 'scanning' | 'ready' | 'failed';

export interface AttachmentDraft {
  key: string;
  name: string;
  status: DraftStatus;
  percent: number;
  failure?: ChatUploadErrorKind | undefined;
  attachment?: PendingAttachment | undefined;
}

export type DraftNotice =
  { kind: 'unsupportedType' | 'tooLarge'; name: string } | { kind: 'tooManyFiles' };

let draftCounter = 0;

export function useAttachmentDrafts() {
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  const draftsRef = useRef<AttachmentDraft[]>([]);
  const preparedRef = useRef(new Map<string, PreparedFile>());

  const commit = useCallback((next: AttachmentDraft[]) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const patch = useCallback(
    (key: string, changes: Partial<AttachmentDraft>) => {
      if (!draftsRef.current.some((draft) => draft.key === key)) {
        return;
      }
      commit(
        draftsRef.current.map((draft) => (draft.key === key ? { ...draft, ...changes } : draft)),
      );
    },
    [commit],
  );

  const upload = useCallback(
    async (key: string, prepared: PreparedFile) => {
      patch(key, { status: 'uploading', percent: 0, failure: undefined });
      try {
        const attachment = await uploadChatAttachment(prepared, {
          onProgress: (percent) => {
            patch(key, { percent });
          },
          onStageChange: (stage) => {
            patch(key, { status: stage });
          },
        });
        preparedRef.current.delete(key);
        patch(key, { status: 'ready', percent: 100, attachment });
      } catch (error) {
        patch(key, {
          status: 'failed',
          failure: error instanceof ChatUploadError ? error.kind : 'upload',
        });
      }
    },
    [patch],
  );

  const addOne = useCallback(
    async (file: PickedFile) => {
      draftCounter += 1;
      const key = `draft-${String(draftCounter)}`;
      commit([...draftsRef.current, { key, name: file.name, status: 'uploading', percent: 0 }]);
      let prepared: PreparedFile;
      try {
        prepared = await prepareFile(file);
      } catch (error) {
        commit(draftsRef.current.filter((draft) => draft.key !== key));
        if (error instanceof AttachmentRejectedError) {
          setNotice({ kind: error.reason, name: file.name });
        } else {
          setNotice({ kind: 'unsupportedType', name: file.name });
        }
        return;
      }
      preparedRef.current.set(key, prepared);
      await upload(key, prepared);
    },
    [commit, upload],
  );

  const add = useCallback(
    (files: PickedFile[]) => {
      setNotice(null);
      const slots = MAX_ATTACHMENTS - draftsRef.current.length;
      if (files.length > slots) {
        setNotice({ kind: 'tooManyFiles' });
      }
      for (const file of files.slice(0, Math.max(0, slots))) {
        void addOne(file);
      }
    },
    [addOne],
  );

  const remove = useCallback(
    (key: string) => {
      preparedRef.current.delete(key);
      commit(draftsRef.current.filter((draft) => draft.key !== key));
    },
    [commit],
  );

  const retry = useCallback(
    (key: string) => {
      const prepared = preparedRef.current.get(key);
      if (prepared) {
        void upload(key, prepared);
      }
    },
    [upload],
  );

  const take = useCallback((): PendingAttachment[] | null => {
    if (draftsRef.current.some((draft) => draft.status !== 'ready')) {
      return null;
    }
    const ready = draftsRef.current.flatMap((draft) =>
      draft.attachment ? [draft.attachment] : [],
    );
    commit([]);
    preparedRef.current.clear();
    return ready;
  }, [commit]);

  const restore = useCallback(
    (attachments: PendingAttachment[]) => {
      commit(
        attachments.map((attachment) => {
          draftCounter += 1;
          return {
            key: `draft-${String(draftCounter)}`,
            name: attachment.name,
            status: 'ready' as const,
            percent: 100,
            attachment,
          };
        }),
      );
    },
    [commit],
  );

  const inFlight = drafts.some(
    (draft) => draft.status === 'uploading' || draft.status === 'scanning',
  );
  const hasFailed = drafts.some((draft) => draft.status === 'failed');

  return {
    drafts,
    notice,
    dismissNotice: () => {
      setNotice(null);
    },
    add,
    remove,
    retry,
    take,
    restore,
    readyCount: drafts.filter((draft) => draft.status === 'ready').length,
    blocked: inFlight || hasFailed,
    inFlight,
  };
}
