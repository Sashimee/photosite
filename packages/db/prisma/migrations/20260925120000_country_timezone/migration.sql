-- AlterTable
ALTER TABLE "Country" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Luxembourg';

ALTER TABLE "Country" ALTER COLUMN "timezone" DROP DEFAULT;
