-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('portfolio', 'avatar', 'cover', 'chat_attachment', 'verification_document', 'delivery_file');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending_upload', 'uploaded', 'scanning', 'clean', 'infected', 'failed', 'processed');

-- CreateEnum
CREATE TYPE "VirusScanStatus" AS ENUM ('pending', 'clean', 'infected', 'failed');

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending_upload',
    "mimeType" TEXT NOT NULL,
    "declaredSizeBytes" INTEGER NOT NULL,
    "actualSizeBytes" INTEGER,
    "objectKey" TEXT NOT NULL,
    "variants" JSONB,
    "exif" JSONB,
    "virusScanStatus" "VirusScanStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Upload_objectKey_key" ON "Upload"("objectKey");

-- CreateIndex
CREATE INDEX "Upload_ownerId_idx" ON "Upload"("ownerId");

-- CreateIndex
CREATE INDEX "Upload_status_idx" ON "Upload"("status");

-- CreateIndex
CREATE INDEX "Upload_status_expiresAt_idx" ON "Upload"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

