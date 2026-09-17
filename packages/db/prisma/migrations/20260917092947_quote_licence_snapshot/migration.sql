-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_requestId_fkey";

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "licenceUsage" "LicenceUsage";
ALTER TABLE "Quote" ADD COLUMN "licenceTextVersion" TEXT;

-- Hand-written backfill: existing rows get their licence snapshot from the
-- request they were quoted on, or from the product tier they were built
-- from, before the column is made required.
UPDATE "Quote" q
SET "licenceUsage" = r."usage"
FROM "Request" r
WHERE q."requestId" = r."id" AND q."licenceUsage" IS NULL;

UPDATE "Quote" q
SET "licenceUsage" = pt."usage", "licenceTextVersion" = pt."licenceTextVersion"
FROM "ProductTier" pt
WHERE q."productTierId" = pt."id" AND q."licenceUsage" IS NULL;

ALTER TABLE "Quote" ALTER COLUMN "licenceUsage" SET NOT NULL;

-- Hand-written CHECK constraint (DATA-MODEL.md invariant).
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_request_or_product_check" CHECK ("requestId" IS NOT NULL OR "productId" IS NOT NULL);
