export interface NotYetImplementedRoute {
  method: string;
  path: string;
}

export const NOT_YET_IMPLEMENTED: readonly NotYetImplementedRoute[] = [
  { method: 'GET', path: '/v1/admin/bookings/export.csv' },
];
