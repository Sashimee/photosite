'use client';

import { useState } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormNotice } from '@/components/ui/form-message';

export function ConfirmActionButton({
  triggerLabel,
  triggerVariant,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  hidden = false,
  disabled = false,
  pending = false,
  error,
  onOpen,
  onConfirm,
}: {
  triggerLabel: string;
  triggerVariant?: ButtonProps['variant'];
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel: string;
  hidden?: boolean;
  disabled?: boolean;
  pending?: boolean;
  error?: string | null;
  onOpen?: () => void;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);

  if (hidden) {
    return null;
  }

  function handleOpenChange(next: boolean) {
    // Ignore attempts to close (Escape, overlay click, the cancel button)
    // while a request is in flight, so the result of that request isn't lost;
    // opening is never blocked, even if `pending` is already true.
    if (pending && !next) {
      return;
    }
    if (next) {
      onOpen?.();
    }
    setOpen(next);
  }

  async function handleConfirm() {
    const succeeded = await onConfirm();
    if (succeeded) {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} disabled={disabled}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold text-foreground">{title}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {description}
        </DialogDescription>
        {error ? <FormNotice tone="error">{error}</FormNotice> : null}
        <div className="flex justify-end gap-3">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void handleConfirm()}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
