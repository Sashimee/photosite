import { describe, expect, it } from 'vitest';
import { truncateNotificationText } from './notification-text.js';

describe('truncateNotificationText', () => {
  it('leaves a short value untouched', () => {
    expect(truncateNotificationText('Jane Doe')).toBe('Jane Doe');
  });

  it('truncates a value past the default limit', () => {
    const value = 'a'.repeat(200);
    expect(truncateNotificationText(value)).toBe('a'.repeat(150));
  });

  it('accepts a custom max length', () => {
    expect(truncateNotificationText('abcdef', 3)).toBe('abc');
  });
});
