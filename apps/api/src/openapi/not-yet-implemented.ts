export interface NotYetImplementedRoute {
  method: string;
  path: string;
}

export const NOT_YET_IMPLEMENTED: readonly NotYetImplementedRoute[] = [
  { method: 'POST', path: '/v1/bookings/:id/refund' },
  { method: 'GET', path: '/v1/admin/bookings' },
  { method: 'GET', path: '/v1/admin/bookings/:id' },
  { method: 'POST', path: '/v1/admin/bookings/:id/refund' },
  { method: 'POST', path: '/v1/admin/bookings/:id/reverse-transfer' },
];
