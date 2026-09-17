import { describe, expect, it } from 'vitest';
import { resolveNotificationChannels } from './notification-channels.js';

describe('resolveNotificationChannels', () => {
  it('defaults every channel to on when there is no preference row', () => {
    expect(resolveNotificationChannels('quote_received', [])).toEqual(['email', 'push', 'in_app']);
  });

  it('suppresses a channel disabled for that type', () => {
    const channels = resolveNotificationChannels('quote_received', [
      { type: 'quote_received', channel: 'email', enabled: false },
    ]);
    expect(channels).toEqual(['push', 'in_app']);
  });

  it('ignores a disabled row for a different type', () => {
    const channels = resolveNotificationChannels('quote_received', [
      { type: 'quote_accepted', channel: 'email', enabled: false },
    ]);
    expect(channels).toEqual(['email', 'push', 'in_app']);
  });

  it('never disables in_app, even if a row says so', () => {
    const channels = resolveNotificationChannels('quote_received', [
      { type: 'quote_received', channel: 'in_app', enabled: false },
    ]);
    expect(channels).toContain('in_app');
  });
});
