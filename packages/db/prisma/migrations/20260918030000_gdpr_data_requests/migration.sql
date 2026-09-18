-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('export', 'delete');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('pending', 'processing', 'ready', 'completed', 'failed', 'cancelled');

-- Note: `prisma migrate diff` also proposed dropping "Booking_location_gist_idx",
-- "PhotographerProfile_location_gist_idx" and "Request_location_gist_idx" here.
-- Those lines are stripped: the GiST indexes are hand-written (DATA-MODEL.md,
-- geography columns use `Unsupported("geography(Point,4326)")`) and Prisma's
-- introspection doesn't see them, so every diff against this schema proposes
-- dropping and never recreates them. This is the known drift documented in
-- docs/steps/1A.9-verification.md and docs/steps/human-followups.md.

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "exportKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataRequest_userId_idx" ON "DataRequest"("userId");

-- CreateIndex
CREATE INDEX "DataRequest_status_requestedAt_idx" ON "DataRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (Prisma has no declarative partial index support, like
-- "VerificationCase_userId_active_key"): enforces at most one pending or
-- processing request per (userId, type), so a second export or delete call
-- while one is already in flight returns the existing row instead of racing
-- a new one. A completed, ready, failed or cancelled row never blocks a new
-- request of the same type.
CREATE UNIQUE INDEX "DataRequest_userId_type_open_key" ON "DataRequest"("userId", "type") WHERE "status" IN ('pending', 'processing');

