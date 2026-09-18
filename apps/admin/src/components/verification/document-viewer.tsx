'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import type { components } from '@photoo/api-client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/lib/api';

type AdminVerificationDocument = components['schemas']['AdminVerificationDocument'];
export type VerificationDocumentMeta = Omit<AdminVerificationDocument, 'downloadUrl'>;

type ViewerState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'scanning' }
  | { kind: 'error' }
  | { kind: 'unsupported' }
  | { kind: 'ready'; objectUrl: string; mimeType: string };

export function DocumentViewer({
  caseId,
  document,
}: {
  caseId: string;
  document: VerificationDocumentMeta;
}) {
  const t = useTranslations('admin.verification.detail.documents');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ViewerState>({ kind: 'idle' });
  const objectUrlRef = useRef<string | null>(null);

  function revoke() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  // Only the unmount case, not `open` toggling: `handleOpenChange` already
  // revokes on every close so a re-open never reuses a stale object URL.
  useEffect(() => {
    return () => {
      revoke();
    };
  }, []);

  async function load() {
    setState({ kind: 'loading' });
    const { data, error } = await api.GET('/v1/admin/verification-cases/{id}', {
      params: { path: { id: caseId } },
    });
    if (error) {
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setState({ kind: 'error' });
      }
      return;
    }
    const found = data.documents.find((candidate) => candidate.id === document.id);
    if (!found?.downloadUrl) {
      setState({ kind: 'scanning' });
      return;
    }
    if (!found.mimeType.startsWith('image/') && found.mimeType !== 'application/pdf') {
      setState({ kind: 'unsupported' });
      return;
    }
    try {
      const response = await fetch(found.downloadUrl, {
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      if (!response.ok) {
        setState({ kind: 'error' });
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      setState({ kind: 'ready', objectUrl, mimeType: found.mimeType });
    } catch {
      setState({ kind: 'error' });
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      void load();
      return;
    }
    revoke();
    setState({ kind: 'idle' });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {t('view')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('viewerTitle', { documentKey: document.documentKey })}</DialogTitle>
        {state.kind === 'idle' || state.kind === 'loading' ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('loading')}
          </p>
        ) : null}
        {state.kind === 'scanning' ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('scanning')}
          </p>
        ) : null}
        {state.kind === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            {t('loadFailed')}
          </p>
        ) : null}
        {state.kind === 'unsupported' ? (
          <p className="text-sm text-muted-foreground">{t('unsupportedType')}</p>
        ) : null}
        {state.kind === 'ready' && state.mimeType.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element -- a per-viewer object URL revoked on close can't go through next/image's cache.
          <img
            src={state.objectUrl}
            alt={t('previewAlt', { documentKey: document.documentKey })}
            referrerPolicy="no-referrer"
            className="max-h-[80vh] w-full object-contain"
          />
        ) : null}
        {state.kind === 'ready' && state.mimeType === 'application/pdf' ? (
          <iframe
            src={state.objectUrl}
            title={t('viewerTitle', { documentKey: document.documentKey })}
            referrerPolicy="no-referrer"
            sandbox=""
            className="h-[80vh] w-full"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
