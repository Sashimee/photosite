-- Note: `prisma migrate diff` also proposed dropping "Booking_location_gist_idx",
-- "JobOffer_location_gist_idx", "PhotographerProfile_location_gist_idx" and
-- "Request_location_gist_idx" here. Those lines are stripped: the GiST
-- indexes are hand-written (DATA-MODEL.md, geography columns use
-- `Unsupported("geography(Point,4326)")`) and Prisma's introspection doesn't
-- see them, so every diff against this schema proposes dropping and never
-- recreates them. This is the known drift documented in
-- docs/steps/1A.9-verification.md and docs/steps/human-followups.md.

-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobOffer" ADD COLUMN     "deletedAt" TIMESTAMP(3);
