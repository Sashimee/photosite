-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('open', 'quoted', 'booked', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn');

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "PhotographerCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "dateFlexible" BOOLEAN NOT NULL DEFAULT false,
    "location" geography(Point, 4326),
    "address" JSONB NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "budgetMinCents" INTEGER NOT NULL,
    "budgetMaxCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "usage" "LicenceUsage" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'open',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "photographerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT,
    "productTierId" TEXT,
    "lineItems" JSONB NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "feePercent" DECIMAL(5,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'sent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Request_clientId_createdAt_idx" ON "Request"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Request_countryCode_idx" ON "Request"("countryCode");

-- Hand-written (Prisma cannot index an Unsupported column): radius search
-- and the future feed's distance filter use ST_DWithin against this index.
CREATE INDEX "Request_location_gist_idx" ON "Request" USING GIST ("location");

-- Hand-written (Prisma has no declarative partial index support): backs the
-- photographer feed's `open|quoted`, non-expired, non-deleted filter and the
-- worker's `quote-expiry` job scan.
CREATE INDEX "Request_status_expiresAt_idx" ON "Request"("status", "expiresAt") WHERE "deletedAt" IS NULL;

-- Hand-written CHECK constraint (DATA-MODEL.md invariant).
ALTER TABLE "Request" ADD CONSTRAINT "Request_budget_range_check" CHECK ("budgetMinCents" <= "budgetMaxCents");

-- CreateIndex
CREATE INDEX "Quote_requestId_idx" ON "Quote"("requestId");

-- CreateIndex
CREATE INDEX "Quote_clientId_createdAt_idx" ON "Quote"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_photographerId_createdAt_idx" ON "Quote"("photographerId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_status_validUntil_idx" ON "Quote"("status", "validUntil");

-- CreateIndex
CREATE INDEX "Quote_productId_idx" ON "Quote"("productId");

-- CreateIndex
CREATE INDEX "Quote_productTierId_idx" ON "Quote"("productTierId");

-- Hand-written (Prisma has no declarative partial index support).
CREATE UNIQUE INDEX "Quote_requestId_photographerId_sent_key" ON "Quote"("requestId", "photographerId") WHERE "status" = 'sent';

-- Hand-written CHECK constraints (DATA-MODEL.md invariant): amounts are
-- computed only by `quoteTotals` in packages/shared and never rewritten, so
-- these can never legitimately fail outside a bug or direct SQL access.
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_subtotalCents_check" CHECK ("subtotalCents" >= 0);
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_platformFeeCents_check" CHECK ("platformFeeCents" >= 0);
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_totalCents_eq_subtotalCents_check" CHECK ("totalCents" = "subtotalCents");

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_photographerId_fkey" FOREIGN KEY ("photographerId") REFERENCES "PhotographerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_productTierId_fkey" FOREIGN KEY ("productTierId") REFERENCES "ProductTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
