import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function FieldError({ id, message }: { id: string; message?: string | undefined }) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

const NOTICE_TONE_CLASSES = {
  info: 'border-border bg-muted text-muted-foreground',
  success: 'border-border bg-muted text-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

export function FormNotice({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof NOTICE_TONE_CLASSES;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-4 py-3 text-sm', NOTICE_TONE_CLASSES[tone])}
    >
      {children}
    </div>
  );
}
