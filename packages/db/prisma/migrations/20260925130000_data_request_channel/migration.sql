-- CreateEnum
CREATE TYPE "DataRequestChannel" AS ENUM ('in_app', 'email', 'support');

-- AlterTable
ALTER TABLE "DataRequest" ADD COLUMN     "channel" "DataRequestChannel" NOT NULL DEFAULT 'in_app';
