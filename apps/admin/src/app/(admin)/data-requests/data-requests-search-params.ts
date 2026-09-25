import {
  DATA_REQUEST_CHANNELS,
  DATA_REQUEST_STATUSES,
  DATA_REQUEST_TYPES,
  IdSchema,
  type DataRequestChannel,
  type DataRequestStatus,
  type DataRequestType,
} from '@photoo/shared';

export type RawDataRequestsSearchParams = Record<string, string | string[] | undefined>;

export interface DataRequestsFilters {
  status?: DataRequestStatus;
  type?: DataRequestType;
  channel?: DataRequestChannel;
  userId?: string;
  userIdInvalid?: boolean;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isDataRequestStatus(value: string): value is DataRequestStatus {
  return (DATA_REQUEST_STATUSES as readonly string[]).includes(value);
}

function isDataRequestType(value: string): value is DataRequestType {
  return (DATA_REQUEST_TYPES as readonly string[]).includes(value);
}

function isDataRequestChannel(value: string): value is DataRequestChannel {
  return (DATA_REQUEST_CHANNELS as readonly string[]).includes(value);
}

export function parseDataRequestsSearchParams(
  raw: RawDataRequestsSearchParams,
): DataRequestsFilters {
  const status = first(raw.status);
  const type = first(raw.type);
  const channel = first(raw.channel);
  const userId = first(raw.userId)?.trim();

  return {
    ...(status && isDataRequestStatus(status) ? { status } : {}),
    ...(type && isDataRequestType(type) ? { type } : {}),
    ...(channel && isDataRequestChannel(channel) ? { channel } : {}),
    ...(userId
      ? { userId, ...(IdSchema.safeParse(userId).success ? {} : { userIdInvalid: true }) }
      : {}),
  };
}

export function dataRequestsFiltersKey(filters: DataRequestsFilters): string {
  return `${filters.status ?? ''}|${filters.type ?? ''}|${filters.channel ?? ''}|${filters.userId ?? ''}|${String(filters.userIdInvalid ?? false)}`;
}
