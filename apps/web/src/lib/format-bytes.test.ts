import { describe, expect, it } from 'vitest';

import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it('renders bytes under 1 KB with no decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('renders kilobytes with one decimal below 10', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('renders kilobytes with no decimals at or above 10', () => {
    expect(formatBytes(12 * 1024)).toBe('12 KB');
  });

  it('renders megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('caps at gigabytes', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2 GB');
  });
});
