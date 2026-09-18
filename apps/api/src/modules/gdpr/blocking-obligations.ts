import { HttpException } from '@nestjs/common';
import type { PrismaClient } from '@photoo/db';

// EU distance-selling right of withdrawal (Directive 2011/83/EU), referenced
// generically in docs/COMPLIANCE.md ("right of withdrawal rules for
// services with a fixed date"); no specific figure is written down anywhere
// in this repo, so this is the standard 14-day period, pending the lawyer
// follow-up already tracked in docs/steps/1A.12-gdpr.md.
const WITHDRAWAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type BlockingObligationReason =
  'VERIFICATION_IN_REVIEW' | 'ACCEPTED_QUOTE_WITHDRAWAL_WINDOW';

function blocked(reason: BlockingObligationReason, message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message, details: { reason } }, 409);
}

// Today's only two honest checks with no `Booking` yet in real use (schema
// merged in #198, but 1A.8's booking flow hasn't landed): an in-review
// verification case, and a conversation on a quote accepted inside the
// withdrawal window. `Quote` has no `acceptedAt`, so `updatedAt` at the
// moment of acceptance is the only timestamp available - see the
// disagreement noted in this step's report. 1A.8 extends this with held
// payments, undelivered bookings, pending payouts and open disputes
// (docs/steps/1A.12-gdpr.md "Notes for later steps").
export async function assertNoBlockingObligations(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const inReviewCase = await prisma.verificationCase.findFirst({
    where: { userId, status: 'in_review' },
    select: { id: true },
  });
  if (inReviewCase) {
    throw blocked(
      'VERIFICATION_IN_REVIEW',
      'A verification case is in review and must be decided or withdrawn before deletion',
    );
  }

  const profile = await prisma.photographerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  const recentAcceptedQuote = await prisma.quote.findFirst({
    where: {
      status: 'accepted',
      updatedAt: { gt: new Date(Date.now() - WITHDRAWAL_WINDOW_MS) },
      OR: [{ clientId: userId }, ...(profile ? [{ photographerId: profile.id }] : [])],
    },
    select: { id: true },
  });
  if (recentAcceptedQuote) {
    throw blocked(
      'ACCEPTED_QUOTE_WITHDRAWAL_WINDOW',
      'An accepted quote is still inside the statutory withdrawal window',
    );
  }
}
