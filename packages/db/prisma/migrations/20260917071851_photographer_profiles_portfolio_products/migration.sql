-- CreateEnum
CREATE TYPE "PhotographerCategory" AS ENUM ('wedding', 'portrait', 'event', 'product', 'real-estate', 'corporate');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('unverified', 'pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "PortfolioImageStatus" AS ENUM ('processing', 'pending_review', 'approved', 'flagged', 'rejected');

-- CreateEnum
CREATE TYPE "LicenceUsage" AS ENUM ('personal', 'commercial', 'editorial', 'extended');

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;

-- CreateTable
CREATE TABLE "PhotographerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "headline" TEXT,
    "bio" JSONB NOT NULL,
    "avatarUploadId" TEXT,
    "coverUploadId" TEXT,
    "links" JSONB NOT NULL,
    "categories" "PhotographerCategory"[],
    "languages" TEXT[],
    "location" geography(Point, 4326),
    "serviceRadiusKm" INTEGER,
    "city" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'unverified',
    "stripeAccountId" TEXT,
    "stripeOnboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotographerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioImage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "order" INTEGER NOT NULL,
    "status" "PortfolioImageStatus" NOT NULL DEFAULT 'processing',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB,
    "category" "PhotographerCategory" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "deliverables" JSONB NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "usage" "LicenceUsage" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT,
    "licenceTextVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhotographerProfile_userId_key" ON "PhotographerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotographerProfile_slug_key" ON "PhotographerProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PhotographerProfile_avatarUploadId_key" ON "PhotographerProfile"("avatarUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotographerProfile_coverUploadId_key" ON "PhotographerProfile"("coverUploadId");

-- CreateIndex
CREATE INDEX "PhotographerProfile_countryCode_idx" ON "PhotographerProfile"("countryCode");

-- CreateIndex
CREATE INDEX "PhotographerProfile_verificationStatus_idx" ON "PhotographerProfile"("verificationStatus");

-- CreateIndex
CREATE INDEX "PhotographerProfile_city_idx" ON "PhotographerProfile"("city");

-- Hand-written (Prisma cannot index an Unsupported column): radius search
-- uses ST_DWithin against this GiST index.
CREATE INDEX "PhotographerProfile_location_gist_idx" ON "PhotographerProfile" USING GIST ("location");

-- Hand-written (Prisma has no declarative partial index support).
CREATE INDEX "PhotographerProfile_isPublished_idx" ON "PhotographerProfile"("isPublished") WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioImage_uploadId_key" ON "PortfolioImage"("uploadId");

-- CreateIndex
CREATE INDEX "PortfolioImage_profileId_idx" ON "PortfolioImage"("profileId");

-- CreateIndex
CREATE INDEX "PortfolioImage_status_idx" ON "PortfolioImage"("status");

-- CreateIndex
CREATE INDEX "Product_profileId_idx" ON "Product"("profileId");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE INDEX "ProductTier_productId_idx" ON "ProductTier"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTier_productId_usage_key" ON "ProductTier"("productId", "usage");

-- AddForeignKey
ALTER TABLE "PhotographerProfile" ADD CONSTRAINT "PhotographerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotographerProfile" ADD CONSTRAINT "PhotographerProfile_avatarUploadId_fkey" FOREIGN KEY ("avatarUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotographerProfile" ADD CONSTRAINT "PhotographerProfile_coverUploadId_fkey" FOREIGN KEY ("coverUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotographerProfile" ADD CONSTRAINT "PhotographerProfile_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioImage" ADD CONSTRAINT "PortfolioImage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PhotographerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioImage" ADD CONSTRAINT "PortfolioImage_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PhotographerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTier" ADD CONSTRAINT "ProductTier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

