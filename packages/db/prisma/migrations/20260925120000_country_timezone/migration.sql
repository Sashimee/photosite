-- AlterTable
ALTER TABLE "Country" ADD COLUMN "timezone" TEXT;

UPDATE "Country" SET "timezone" = 'Europe/Luxembourg' WHERE "code" = 'LU';

ALTER TABLE "Country" ALTER COLUMN "timezone" SET NOT NULL;
