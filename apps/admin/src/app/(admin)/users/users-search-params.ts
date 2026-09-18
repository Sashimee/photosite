import { USER_ROLES, USER_STATUSES, type UserRole, type UserStatus } from '@photoo/shared';

export type RawUsersSearchParams = Record<string, string | string[] | undefined>;

export interface UsersFilters {
  q?: string;
  role?: UserRole;
  status?: UserStatus;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

function isUserStatus(value: string): value is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(value);
}

// Reads the same three filters the API accepts (docs/steps/1D.2-admin-users.md)
// straight off the URL, so the filter form works with plain GET navigation and
// no client JS. An unrecognised role/status (a stale bookmark, a hand-edited
// URL) is dropped rather than sent to the API, which would otherwise 400.
export function parseUsersSearchParams(raw: RawUsersSearchParams): UsersFilters {
  const q = first(raw.q)?.trim();
  const role = first(raw.role);
  const status = first(raw.status);

  return {
    ...(q ? { q } : {}),
    ...(role && isUserRole(role) ? { role } : {}),
    ...(status && isUserStatus(status) ? { status } : {}),
  };
}

export function usersFiltersKey(filters: UsersFilters): string {
  return `${filters.q ?? ''}|${filters.role ?? ''}|${filters.status ?? ''}`;
}
