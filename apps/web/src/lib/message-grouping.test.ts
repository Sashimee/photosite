import { describe, expect, it } from 'vitest';

import { dayKey, groupMessages } from './message-grouping';

// `dayKey` groups by the viewer's local calendar day (correct behaviour),
// so a day-boundary test needs a fixed zone to be deterministic in CI.
process.env.TZ = 'UTC';

describe('dayKey', () => {
  it('reduces a timestamp to its calendar day', () => {
    expect(dayKey('2026-01-01T10:00:00.000Z')).toBe(dayKey('2026-01-01T23:59:00.000Z'));
    expect(dayKey('2026-01-01T10:00:00.000Z')).not.toBe(dayKey('2026-01-02T00:00:00.000Z'));
  });
});

describe('groupMessages', () => {
  it('marks the first message as a new day and a sender header', () => {
    const [flag] = groupMessages([{ senderId: 'a', createdAt: '2026-01-01T10:00:00.000Z' }]);
    expect(flag).toEqual({ isNewDay: true, showSender: true });
  });

  it('hides the sender header for consecutive messages from the same sender on the same day', () => {
    const flags = groupMessages([
      { senderId: 'a', createdAt: '2026-01-01T10:00:00.000Z' },
      { senderId: 'a', createdAt: '2026-01-01T10:01:00.000Z' },
    ]);
    expect(flags[1]).toEqual({ isNewDay: false, showSender: false });
  });

  it('shows the sender header again once the sender changes', () => {
    const flags = groupMessages([
      { senderId: 'a', createdAt: '2026-01-01T10:00:00.000Z' },
      { senderId: 'b', createdAt: '2026-01-01T10:01:00.000Z' },
    ]);
    expect(flags[1]).toEqual({ isNewDay: false, showSender: true });
  });

  it('starts a new day group even for the same sender', () => {
    const flags = groupMessages([
      { senderId: 'a', createdAt: '2026-01-01T23:59:00.000Z' },
      { senderId: 'a', createdAt: '2026-01-02T00:01:00.000Z' },
    ]);
    expect(flags[1]).toEqual({ isNewDay: true, showSender: true });
  });
});
