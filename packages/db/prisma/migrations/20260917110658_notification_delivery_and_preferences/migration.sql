-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "pushSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_channel_key" ON "NotificationPreference"("userId", "type", "channel");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (Prisma has no declarative partial index support). Backs the
-- notify-sweep query: for either channel, "channels" wants it and that
-- channel's sent-at is still null, and "createdAt" is older than the sweep
-- window. That per-channel condition always implies "emailSentAt IS NULL OR
-- pushSentAt IS NULL", so this partial index on the pending rows serves the
-- sweep's createdAt range scan; "channels" and the specific sent-at column
-- are then filtered against that already-narrow set.
CREATE INDEX "Notification_pending_createdAt_idx" ON "Notification"("createdAt") WHERE "emailSentAt" IS NULL OR "pushSentAt" IS NULL;
