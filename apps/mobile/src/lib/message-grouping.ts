export function dayKey(createdAt: string): string {
  return new Date(createdAt).toDateString();
}

export interface MessageGroupingFlags {
  isNewDay: boolean;
  showSender: boolean;
}

export function groupMessages(
  items: readonly { senderId: string; createdAt: string }[],
): MessageGroupingFlags[] {
  const flags: MessageGroupingFlags[] = [];
  let previousDay: string | null = null;
  let previousSender: string | null = null;

  for (const item of items) {
    const day = dayKey(item.createdAt);
    const isNewDay = day !== previousDay;
    const showSender = isNewDay || item.senderId !== previousSender;
    flags.push({ isNewDay, showSender });
    previousDay = day;
    previousSender = item.senderId;
  }

  return flags;
}
