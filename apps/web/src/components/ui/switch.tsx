import { type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <label className={cn('relative inline-flex h-6 w-11 shrink-0 cursor-pointer', className)}>
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform peer-checked:translate-x-5"
      />
    </label>
  );
}
