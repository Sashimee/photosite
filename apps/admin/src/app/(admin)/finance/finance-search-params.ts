import {
  ADMIN_BOOKING_DISPUTE_FILTERS,
  AdminBookingsQuerySchema,
  type BookingStatus,
} from '@photoo/shared';

export type RawFinanceSearchParams = Record<string, string | string[] | undefined>;

export interface FinanceFilters {
  status?: BookingStatus[];
  createdFrom?: string;
  createdTo?: string;
  dispute?: (typeof ADMIN_BOOKING_DISPUTE_FILTERS)[number];
}

const DATE_FIELDS = ['createdFrom', 'createdTo'];

function nonEmpty(value: string | string[] | undefined): string | string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.filter((entry) => entry !== '');
    return values.length > 0 ? values : undefined;
  }
  return value === '' ? undefined : value;
}

function toFilters(data: ReturnType<typeof AdminBookingsQuerySchema.parse>): FinanceFilters {
  return {
    ...(data.status ? { status: data.status } : {}),
    ...(data.createdFrom && data.createdTo
      ? { createdFrom: data.createdFrom, createdTo: data.createdTo }
      : {}),
    ...(data.dispute ? { dispute: data.dispute } : {}),
  };
}

export function parseFinanceSearchParams(raw: RawFinanceSearchParams): FinanceFilters {
  const candidate = Object.fromEntries(
    (['status', 'createdFrom', 'createdTo', 'dispute'] as const)
      .map((field) => [field, nonEmpty(raw[field])] as const)
      .filter(([, value]) => value !== undefined),
  );

  const first = AdminBookingsQuerySchema.safeParse(candidate);
  if (first.success) {
    return toFilters(first.data);
  }

  const invalid = new Set(first.error.issues.map((issue) => String(issue.path[0])));
  const dropDates = DATE_FIELDS.some((field) => invalid.has(field));
  const remaining = Object.fromEntries(
    Object.entries(candidate).filter(
      ([field]) => !invalid.has(field) && !(dropDates && DATE_FIELDS.includes(field)),
    ),
  );
  const second = AdminBookingsQuerySchema.safeParse(remaining);
  if (!second.success) {
    throw new Error('Finance filters still invalid after dropping the failing fields');
  }
  return toFilters(second.data);
}

export function financeFiltersKey(filters: FinanceFilters): string {
  return JSON.stringify([
    filters.status ?? [],
    filters.createdFrom ?? '',
    filters.createdTo ?? '',
    filters.dispute ?? '',
  ]);
}
