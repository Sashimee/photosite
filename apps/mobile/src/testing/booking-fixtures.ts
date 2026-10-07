export function makeBooking(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    quoteId: `q-${id}`,
    clientId: 'c1',
    photographerId: 'p1',
    scheduledAt: '2027-01-01T12:00:00.000Z',
    location: null,
    total: { amountCents: 157777, currency: 'EUR' },
    status: 'pending_payment',
    releaseDueAt: null,
    deliveredAt: null,
    releasedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    ...overrides,
  };
}
