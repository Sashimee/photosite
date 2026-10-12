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

type ParsedQuery = ReturnType<typeof AdminBookingsQuerySchema.parse>;

function parseSubset(raw: RawFinanceSearchParams, fields: readonly string[]): Partial<ParsedQuery> {
  const candidate = Object.fromEntries(
    fields
      .map((field) => [field, nonEmpty(raw[field])] as const)
      .filter(([, value]) => value !== undefined),
  );
  const result = AdminBookingsQuerySchema.safeParse(candidate);
  return result.success ? result.data : {};
}

export function parseFinanceSearchParams(raw: RawFinanceSearchParams): FinanceFilters {
  const { status } = parseSubset(raw, ['status']);
  const { dispute } = parseSubset(raw, ['dispute']);
  const { createdFrom, createdTo } = parseSubset(raw, DATE_FIELDS);

  return {
    ...(status ? { status } : {}),
    ...(createdFrom && createdTo ? { createdFrom, createdTo } : {}),
    ...(dispute ? { dispute } : {}),
  };
}

export function financeFiltersKey(filters: FinanceFilters): string {
  return JSON.stringify([
    filters.status ?? [],
    filters.createdFrom ?? '',
    filters.createdTo ?? '',
    filters.dispute ?? '',
  ]);
}
