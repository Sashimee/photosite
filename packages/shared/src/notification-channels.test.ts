import { describe, expect, it } from 'vitest';
import { isChannelAvailable, resolveNotificationChannels } from './notification-channels.js';

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

  it('defaults email off for message_received when there is no preference row', () => {
    expect(resolveNotificationChannels('message_received', [])).toEqual(['push', 'in_app']);
  });

  it('never re-enables email for message_received, even with an explicit preference row', () => {
    const channels = resolveNotificationChannels('message_received', [
      { type: 'message_received', channel: 'email', enabled: true },
    ]);
    expect(channels).toEqual(['push', 'in_app']);
  });
});

describe('isChannelAvailable', () => {
  it('is false for message_received email', () => {
    expect(isChannelAvailable('message_received', 'email')).toBe(false);
  });

  it('is true for every other type/channel pair', () => {
    expect(isChannelAvailable('message_received', 'push')).toBe(true);
    expect(isChannelAvailable('message_received', 'in_app')).toBe(true);
    expect(isChannelAvailable('quote_received', 'email')).toBe(true);
  });
});
