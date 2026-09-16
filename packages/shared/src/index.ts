export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isLocale,
  resolveLocale,
  type Locale,
} from './locale.js';

export { USER_ROLES, USER_STATUSES, type UserRole, type UserStatus } from './enums.js';

export { calculatePlatformFee, quoteTotals, type LineItem, type QuoteTotals } from './fee.js';

export {
  ApiErrorSchema,
  CountryCodeSchema,
  CurrencyCodeSchema,
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  LocaleSchema,
  MoneySchema,
  STANDARD_ERROR_STATUS_CODES,
  errorResponses,
  paginatedResponseSchema,
  type StandardErrorStatusCode,
} from './contract/common.js';

export { API_PREFIX, apiPath, registry } from './contract/registry.js';

export { buildOpenApiDocument, OPENAPI_INFO_VERSION } from './contract/generate.js';

export {
  AddRoleRequestSchema,
  AddRoleResponseSchema,
  AuthSessionSchema,
  ConfirmPasswordResetRequestSchema,
  ConfirmPasswordResetResponseSchema,
  OAUTH_PROVIDERS,
  RequestPasswordResetRequestSchema,
  RequestPasswordResetResponseSchema,
  SIGNUP_ROLES,
  SessionResponseSchema,
  SignInRequestSchema,
  SignInResponseSchema,
  SignUpRequestSchema,
  SignUpResponseSchema,
  TotpDisableRequestSchema,
  TotpEnrollResponseSchema,
  TotpResponseSchema,
  TotpVerifyRequestSchema,
  UserSchema,
  VerifyEmailRequestSchema,
} from './contract/auth.js';
