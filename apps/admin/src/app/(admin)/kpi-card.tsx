import type { useFormatter } from 'next-intl';

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Format = Pick<ReturnType<typeof useFormatter>, 'number'>;

export interface KpiDelta {
  current: number;
  previous: number;
}

function describeDelta(
  { current, previous }: KpiDelta,
  t: Translate,
  format: Format,
): { label: string; tone: 'up' | 'down' | 'flat' } {
  if (current === previous) {
    return { label: t('delta.unchanged'), tone: 'flat' };
  }
  if (previous === 0) {
    return { label: t('delta.new'), tone: 'up' };
  }
  const ratio = Math.abs(current - previous) / previous;
  const value = format.number(ratio, { style: 'percent', maximumFractionDigits: 0 });
  return current > previous
    ? { label: t('delta.increase', { value }), tone: 'up' }
    : { label: t('delta.decrease', { value }), tone: 'down' };
}

const TONE_CLASS = {
  up: 'text-emerald-700',
  down: 'text-red-700',
  flat: 'text-muted-foreground',
} as const;

export function KpiCard({
  label,
  currentDisplay,
  previousDisplay,
  delta,
  t,
  format,
}: {
  label: string;
  currentDisplay: string;
  previousDisplay: string;
  delta: KpiDelta;
  t: Translate;
  format: Format;
}) {
  const { label: deltaLabel, tone } = describeDelta(delta, t, format);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold text-foreground">{currentDisplay}</dd>
      <dd className={`text-sm font-medium ${TONE_CLASS[tone]}`}>{deltaLabel}</dd>
      <dd className="text-xs text-muted-foreground">
        {t('delta.previous', { value: previousDisplay })}
      </dd>
    </div>
  );
}
