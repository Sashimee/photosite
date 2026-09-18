export interface NotYetImplementedRoute {
  method: string;
  path: string;
}

export const NOT_YET_IMPLEMENTED: readonly NotYetImplementedRoute[] = [
  { method: 'GET', path: '/v1/bookings' },
  { method: 'GET', path: '/v1/bookings/:id' },
  { method: 'POST', path: '/v1/bookings/:id/delivery' },
  { method: 'POST', path: '/v1/bookings/:id/accept-delivery' },
  { method: 'POST', path: '/v1/bookings/:id/cancel' },
  { method: 'POST', path: '/v1/bookings/:id/payment-intent' },
  { method: 'GET', path: '/v1/admin/provenance-checks' },
  { method: 'GET', path: '/v1/admin/provenance-checks/:id' },
  { method: 'POST', path: '/v1/admin/provenance-checks/:id/approve' },
  { method: 'POST', path: '/v1/admin/provenance-checks/:id/reject' },
  { method: 'GET', path: '/v1/admin/bookings' },
  { method: 'GET', path: '/v1/admin/bookings/:id' },
  { method: 'POST', path: '/v1/admin/bookings/:id/refund' },
  { method: 'POST', path: '/v1/admin/bookings/:id/reverse-transfer' },
  { method: 'POST', path: '/v1/me/data-requests' },
  { method: 'GET', path: '/v1/me/data-requests' },
  { method: 'POST', path: '/v1/consents' },
];
