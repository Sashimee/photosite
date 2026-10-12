import { useCallback, useRef, useState } from 'react';

import type { components } from '@photoo/api-client';

import { AttachmentRejectedError, type PickedFile } from './chat-attachments';
import {
  VerificationUploadError,
  attachVerificationDocument,
  uploadVerificationDocument,
  type VerificationUploadErrorKind,
  type VerificationUploadStage,
} from './verification-upload';

type VerificationDocument = components['schemas']['VerificationDocument'];

export type VerificationUploadFailure =
  VerificationUploadErrorKind | 'unsupportedType' | 'tooLarge' | 'unknown';

export interface VerificationUploadEntry {
  stage: VerificationUploadStage;
  percent: number;
  failure?: VerificationUploadFailure | undefined;
}

interface SlotRequirement {
  key: string;
  acceptedMimeTypes: readonly string[];
}

function failureOf(error: unknown): VerificationUploadFailure {
  if (error instanceof AttachmentRejectedError) {
    return error.reason;
  }
  if (error instanceof VerificationUploadError) {
    return error.kind;
  }
  return 'unknown';
}

export function useVerificationUploads(onAttached: (document: VerificationDocument) => void) {
  const [entries, setEntries] = useState<Record<string, VerificationUploadEntry>>({});
  const filesRef = useRef(new Map<string, PickedFile>());
  const scannedRef = useRef(new Map<string, string>());
  const activeRef = useRef(new Set<string>());

  const patch = useCallback((key: string, changes: Partial<VerificationUploadEntry>) => {
    setEntries((current) => ({
      ...current,
      [key]: { stage: 'uploading', percent: 0, ...current[key], ...changes },
    }));
  }, []);

  const clear = useCallback((key: string) => {
    filesRef.current.delete(key);
    scannedRef.current.delete(key);
    setEntries((current) => {
      return Object.fromEntries(Object.entries(current).filter(([slot]) => slot !== key));
    });
  }, []);

  const run = useCallback(
    async (requirement: SlotRequirement) => {
      const { key } = requirement;
      const file = filesRef.current.get(key);
      if (!file || activeRef.current.has(key)) {
        return;
      }
      activeRef.current.add(key);
      patch(key, { stage: 'uploading', percent: 0, failure: undefined });
      try {
        const scannedUploadId = scannedRef.current.get(key);
        let document: VerificationDocument;
        if (scannedUploadId) {
          patch(key, { stage: 'attaching' });
          document = await attachVerificationDocument(scannedUploadId, key);
        } else {
          document = await uploadVerificationDocument(file, requirement, {
            onProgress: (percent) => {
              patch(key, { percent });
            },
            onStageChange: (stage) => {
              patch(key, { stage });
            },
          });
        }
        clear(key);
        onAttached(document);
      } catch (error) {
        if (error instanceof VerificationUploadError && error.uploadId) {
          scannedRef.current.set(key, error.uploadId);
        }
        patch(key, { failure: failureOf(error) });
      } finally {
        activeRef.current.delete(key);
      }
    },
    [clear, onAttached, patch],
  );

  const start = useCallback(
    (requirement: SlotRequirement, file: PickedFile) => {
      filesRef.current.set(requirement.key, file);
      scannedRef.current.delete(requirement.key);
      void run(requirement);
    },
    [run],
  );

  const retry = useCallback(
    (requirement: SlotRequirement) => {
      void run(requirement);
    },
    [run],
  );

  return { entries, start, retry, dismiss: clear };
}
