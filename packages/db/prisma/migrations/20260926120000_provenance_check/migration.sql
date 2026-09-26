-- CreateEnum
CREATE TYPE "ProvenanceVerdict" AS ENUM ('pass', 'review', 'fail');

-- CreateTable
CREATE TABLE "ProvenanceCheck" (
    "id" TEXT NOT NULL,
    "portfolioImageId" TEXT NOT NULL,
    "aiScore" DECIMAL(4,3),
    "aiVendor" TEXT NOT NULL,
    "reverseMatches" JSONB NOT NULL,
    "c2paValid" BOOLEAN,
    "exifCamera" TEXT,
    "exifCapturedAt" TIMESTAMP(3),
    "score" DECIMAL(4,3) NOT NULL,
    "verdict" "ProvenanceVerdict" NOT NULL,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvenanceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProvenanceCheck_portfolioImageId_key" ON "ProvenanceCheck"("portfolioImageId");

-- CreateIndex
CREATE INDEX "ProvenanceCheck_verdict_createdAt_idx" ON "ProvenanceCheck"("verdict", "createdAt");

-- AddForeignKey
ALTER TABLE "ProvenanceCheck" ADD CONSTRAINT "ProvenanceCheck_portfolioImageId_fkey" FOREIGN KEY ("portfolioImageId") REFERENCES "PortfolioImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceCheck" ADD CONSTRAINT "ProvenanceCheck_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

