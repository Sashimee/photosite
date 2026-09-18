import type { components } from '@photoo/api-client';

type ConversationParticipant = components['schemas']['ConversationParticipant'];

// A client participant's `displayName` is deliberately null (chat-mapper.ts
// on the API side: their only other name, `User.name`, defaults to their
// email local part and must never reach another participant), so the UI
// falls back to a role label instead of the name, id or email.
export function participantDisplayName(
  participant: Pick<ConversationParticipant, 'user'>,
  clientLabel: string,
): string {
  return participant.user.displayName ?? clientLabel;
}

export function findOtherParticipant(
  participants: ConversationParticipant[],
  currentUserId: string,
): ConversationParticipant | undefined {
  return participants.find((participant) => participant.userId !== currentUserId);
}
