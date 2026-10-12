import { useCallback, useRef, useState } from 'react';

import type { components } from '@photoo/api-client';

import { AttachmentRejectedError, type PickedFile } from './chat-attachments';
import {
  PortfolioUploadError,
  attachPortfolioImage,
  uploadPortfolioImage,
  type PortfolioUploadErrorKind,
  type PortfolioUploadStage,
} from './portfolio-upload';

type PortfolioImage = components['schemas']['PortfolioImage'];

export type PortfolioUploadFailure =
  PortfolioUploadErrorKind | 'unsupportedType' | 'tooLarge' | 'unknown';

export interface PortfolioUploadEntry {
  key: string;
  name: string;
  stage: PortfolioUploadStage;
  percent: number;
  failure?: PortfolioUploadFailure | undefined;
}

let entryCounter = 0;

function failureOf(error: unknown): PortfolioUploadFailure {
  if (error instanceof AttachmentRejectedError) {
    return error.reason;
  }
  if (error instanceof PortfolioUploadError) {
    return error.kind;
  }
  return 'unknown';
}

export function usePortfolioUploads(onAttached: (image: PortfolioImage) => void) {
  const [entries, setEntries] = useState<PortfolioUploadEntry[]>([]);
  const filesRef = useRef(new Map<string, PickedFile>());
  const scannedRef = useRef(new Map<string, string>());

  const patch = useCallback((key: string, changes: Partial<PortfolioUploadEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)),
    );
  }, []);

  const drop = useCallback((key: string) => {
    filesRef.current.delete(key);
    scannedRef.current.delete(key);
    setEntries((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const run = useCallback(
    async (key: string) => {
      const file = filesRef.current.get(key);
      if (!file) {
        return;
      }
      patch(key, { stage: 'uploading', percent: 0, failure: undefined });
      try {
        const scannedUploadId = scannedRef.current.get(key);
        let image: PortfolioImage;
        if (scannedUploadId) {
          patch(key, { stage: 'attaching' });
          image = await attachPortfolioImage(scannedUploadId);
        } else {
          image = await uploadPortfolioImage(file, {
            onProgress: (percent) => {
              patch(key, { percent });
            },
            onStageChange: (stage) => {
              patch(key, { stage });
            },
          });
        }
        drop(key);
        onAttached(image);
      } catch (error) {
        if (error instanceof PortfolioUploadError && error.uploadId) {
          scannedRef.current.set(key, error.uploadId);
        }
        patch(key, { failure: failureOf(error) });
      }
    },
    [drop, onAttached, patch],
  );

  const add = useCallback(
    (files: PickedFile[]) => {
      const added = files.map((file) => {
        entryCounter += 1;
        const key = `portfolio-upload-${String(entryCounter)}`;
        filesRef.current.set(key, file);
        return { key, name: file.name, stage: 'uploading' as const, percent: 0 };
      });
      setEntries((current) => [...current, ...added]);
      for (const { key } of added) {
        void run(key);
      }
    },
    [run],
  );

  const retry = useCallback(
    (key: string) => {
      void run(key);
    },
    [run],
  );

  return { entries, add, retry, dismiss: drop };
}
