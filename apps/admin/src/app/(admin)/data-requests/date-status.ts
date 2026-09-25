export function hasPassed(dateTime: string, now: Date = new Date()): boolean {
  return new Date(dateTime).getTime() <= now.getTime();
}
