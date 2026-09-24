'use client';

import { useRouter } from 'next/navigation';

import { TakedownDialog, type TakedownTarget } from '../takedown-dialog';
import type { DirectTakedownTargetType } from './direct-takedown-search-params';

// Lands on the report the API synthesises for this takedown (D25,
// docs/DECISIONS.md), which is the same page a restore is done from later -
// there is no separate "direct takedown" record to view.
export function DirectTakedownResult({
  targetType,
  targetId,
  targetLabel,
  slug,
}: {
  targetType: DirectTakedownTargetType;
  targetId: string;
  targetLabel: string;
  slug: string;
}) {
  const router = useRouter();
  const target: TakedownTarget = { kind: 'direct', targetType, targetId };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{targetLabel}</p>
        <p className="font-mono text-sm text-muted-foreground">{slug}</p>
      </div>
      <div>
        <TakedownDialog
          target={target}
          targetLabel={targetLabel}
          onDecided={(report) => {
            router.push(`/moderation/${report.id}`);
          }}
        />
      </div>
    </div>
  );
}
