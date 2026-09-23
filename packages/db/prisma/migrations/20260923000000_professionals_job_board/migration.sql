-- CreateEnum
CREATE TYPE "JobOfferStatus" AS ENUM ('draft', 'published', 'closed', 'expired');

-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('submitted', 'shortlisted', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "ListingKind" AS ENUM ('job_offer', 'featured_profile');

-- CreateEnum
CREATE TYPE "ListingPlan" AS ENUM ('free', 'paid', 'featured');

-- AlterEnum
ALTER TYPE "UploadPurpose" ADD VALUE 'logo';

-- Note: `prisma migrate diff` also proposed dropping "Booking_location_gist_idx",
-- "PhotographerProfile_location_gist_idx" and "Request_location_gist_idx" here.
-- Those lines are stripped: the GiST indexes are hand-written (DATA-MODEL.md,
-- geography columns use `Unsupported("geography(Point,4326)")`) and Prisma's
-- introspection doesn't see them, so every diff against this schema proposes
-- dropping and never recreates them. This is the known drift documented in
-- docs/steps/1A.9-verification.md and docs/steps/human-followups.md.

-- CreateTable
CREATE TABLE "ProfessionalProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "vatNumber" TEXT,
    "logoUploadId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOffer" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "PhotographerCategory" NOT NULL,
    "location" geography(Point, 4326),
    "city" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "compensation" JSONB,
    "status" "JobOfferStatus" NOT NULL DEFAULT 'draft',
    "listingId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "jobOfferId" TEXT NOT NULL,
    "photographerId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "portfolioLink" TEXT,
    "status" "JobApplicationStatus" NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "ListingKind" NOT NULL,
    "plan" "ListingPlan" NOT NULL DEFAULT 'free',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "stripeCheckoutSessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalProfile_userId_key" ON "ProfessionalProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalProfile_logoUploadId_key" ON "ProfessionalProfile"("logoUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_slug_key" ON "JobOffer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_listingId_key" ON "JobOffer"("listingId");

-- CreateIndex
CREATE INDEX "JobOffer_professionalId_idx" ON "JobOffer"("professionalId");

-- CreateIndex
CREATE INDEX "JobOffer_status_publishedAt_idx" ON "JobOffer"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "JobOffer_countryCode_city_idx" ON "JobOffer"("countryCode", "city");

-- Hand-written (Prisma cannot index an Unsupported column): the public job
-- board's location filter uses ST_DWithin against this GiST index, same
-- pattern as PhotographerProfile/Request (DATA-MODEL.md).
CREATE INDEX "JobOffer_location_gist_idx" ON "JobOffer" USING GIST ("location");

-- CreateIndex
CREATE INDEX "JobApplication_jobOfferId_createdAt_idx" ON "JobApplication"("jobOfferId", "createdAt");

-- CreateIndex
CREATE INDEX "JobApplication_photographerId_createdAt_idx" ON "JobApplication"("photographerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_jobOfferId_photographerId_key" ON "JobApplication"("jobOfferId", "photographerId");

-- CreateIndex
CREATE INDEX "Listing_ownerId_kind_idx" ON "Listing"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "Listing_expiresAt_idx" ON "Listing"("expiresAt");

-- AddForeignKey
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_logoUploadId_fkey" FOREIGN KEY ("logoUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobOfferId_fkey" FOREIGN KEY ("jobOfferId") REFERENCES "JobOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_photographerId_fkey" FOREIGN KEY ("photographerId") REFERENCES "PhotographerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
