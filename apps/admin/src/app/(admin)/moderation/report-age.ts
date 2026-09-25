const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days elapsed since a report was filed, for the queue's age column
// (docs/steps/1D.6-moderation.md: "a queue that cannot show age silently
// starves its oldest item"). Clamped to zero for a `createdAt` in the future
// (clock skew between this browser and the API) rather than showing a
// negative age.
export function reportAgeDays(createdAt: string, now: Date = new Date()): number {
  const elapsedMs = now.getTime() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(elapsedMs / DAY_MS));
}
