-- CreateEnum
CREATE TYPE "VerificationCaseStatus" AS ENUM ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'expired');

-- CreateTable
CREATE TABLE "VerificationCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "status" "VerificationCaseStatus" NOT NULL DEFAULT 'draft',
    "businessName" TEXT,
    "vatNumber" TEXT,
    "businessRegistrationNumber" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "assignedAdminId" TEXT,
    "decidedByAdminId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationCase_userId_idx" ON "VerificationCase"("userId");

-- CreateIndex
CREATE INDEX "VerificationCase_countryCode_idx" ON "VerificationCase"("countryCode");

-- CreateIndex
CREATE INDEX "VerificationCase_status_idx" ON "VerificationCase"("status");

-- CreateIndex
CREATE INDEX "VerificationCase_assignedAdminId_idx" ON "VerificationCase"("assignedAdminId");

-- CreateIndex
CREATE INDEX "VerificationCase_decidedByAdminId_idx" ON "VerificationCase"("decidedByAdminId");

-- Hand-written (Prisma has no declarative partial index support): enforces
-- at most one active case (`draft`, `submitted` or `in_review`) per user, so
-- a photographer can't open a second case while one is already in flight. A
-- rejected or expired case is excluded, so a new draft can always start.
CREATE UNIQUE INDEX "VerificationCase_userId_active_key" ON "VerificationCase"("userId") WHERE "status" IN ('draft', 'submitted', 'in_review');

-- CreateIndex
CREATE UNIQUE INDEX "VerificationDocument_uploadId_key" ON "VerificationDocument"("uploadId");

-- CreateIndex
CREATE INDEX "VerificationDocument_caseId_idx" ON "VerificationDocument"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationDocument_caseId_documentKey_key" ON "VerificationDocument"("caseId", "documentKey");

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_decidedByAdminId_fkey" FOREIGN KEY ("decidedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "VerificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
