import type { components } from '@photoo/api-client';

type ConversationParticipant = components['schemas']['ConversationParticipant'];

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
