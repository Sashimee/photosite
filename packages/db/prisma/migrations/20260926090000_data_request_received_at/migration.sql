-- AlterTable
ALTER TABLE "DataRequest" ADD COLUMN     "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "DataRequest" SET "receivedAt" = "requestedAt";
