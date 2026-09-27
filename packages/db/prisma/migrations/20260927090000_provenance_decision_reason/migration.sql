-- CreateEnum
CREATE TYPE "ProvenanceDecisionReason" AS ENUM ('ai_generated', 'not_own_work', 'manipulated_metadata', 'other');

-- AlterTable
ALTER TABLE "ProvenanceCheck" ADD COLUMN     "decisionReason" "ProvenanceDecisionReason",
ADD COLUMN     "decisionReasonText" TEXT;
