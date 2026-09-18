const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = Math.round(value * 10) / 10;
  const formatted = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  const unit = UNITS[unitIndex] ?? 'B';
  return `${formatted} ${unit}`;
}
