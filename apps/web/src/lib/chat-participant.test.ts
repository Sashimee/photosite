import { describe, expect, it } from 'vitest';

import { findOtherParticipant, participantDisplayName } from './chat-participant';

describe('participantDisplayName', () => {
  it('renders the display name when present', () => {
    expect(
      participantDisplayName(
        { user: { id: 'u1', displayName: 'Jane Doe', avatarUrl: null } },
        'Client',
      ),
    ).toBe('Jane Doe');
  });

  it('falls back to the role label instead of an email or id when displayName is null', () => {
    expect(
      participantDisplayName({ user: { id: 'u1', displayName: null, avatarUrl: null } }, 'Client'),
    ).toBe('Client');
  });
});

describe('findOtherParticipant', () => {
  const me = {
    userId: 'me',
    user: { id: 'me', displayName: null, avatarUrl: null },
    lastReadAt: null,
  };
  const them = {
    userId: 'them',
    user: { id: 'them', displayName: 'Jane Doe', avatarUrl: null },
    lastReadAt: null,
  };

  it('returns the participant that is not the current user', () => {
    expect(findOtherParticipant([me, them], 'me')?.userId).toBe('them');
  });

  it('returns undefined when every participant is the current user', () => {
    expect(findOtherParticipant([me], 'me')).toBeUndefined();
  });
});
