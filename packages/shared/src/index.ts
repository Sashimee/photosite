export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isLocale,
  resolveLocale,
  type Locale,
} from './locale.js';

export {
  USER_ROLES,
  USER_STATUSES,
  PHOTOGRAPHER_CATEGORIES,
  VERIFICATION_STATUSES,
  PORTFOLIO_IMAGE_STATUSES,
  LICENCE_USAGES,
  REQUEST_STATUSES,
  QUOTE_STATUSES,
  BOOKING_STATUSES,
  type UserRole,
  type UserStatus,
  type PhotographerCategory,
  type VerificationStatus,
  type PortfolioImageStatus,
  type LicenceUsage,
  type RequestStatus,
  type QuoteStatus,
  type BookingStatus,
} from './enums.js';

export { calculatePlatformFee, quoteTotals, type LineItem, type QuoteTotals } from './fee.js';

export {
  ApiErrorSchema,
  CountryCodeSchema,
  CurrencyCodeSchema,
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  LanguageCodeSchema,
  LatLngSchema,
  LocaleSchema,
  MoneySchema,
  SlugSchema,
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

export {
  LocalizedTextSchema,
  OwnPhotographerProfileSchema,
  PhotographerCategorySchema,
  PhotographerSearchQuerySchema,
  PhotographerSummarySchema,
  PortfolioImageSchema,
  ProfileLinksSchema,
  PublicPhotographerProfileSchema,
  PublicPortfolioImageSchema,
  ReorderPortfolioRequestSchema,
  UpdatePhotographerProfileRequestSchema,
} from './contract/profiles.js';

export {
  CreateProductRequestSchema,
  CreateProductTierRequestSchema,
  LicenceUsageSchema,
  ProductSchema,
  ProductTierSchema,
  UpdateProductRequestSchema,
} from './contract/products.js';

export {
  AddressSchema,
  CreateRequestRequestSchema,
  RequestCategorySchema,
  RequestSchema,
  RequestUsageSchema,
} from './contract/requests.js';

export { CreateQuoteRequestSchema, LineItemSchema, QuoteSchema } from './contract/quotes.js';

export {
  BookingSchema,
  CancelBookingRequestSchema,
  CreateDeliveryRequestSchema,
  CreateDeliveryResponseSchema,
  DeliverySchema,
  PaymentIntentResponseSchema,
} from './contract/bookings.js';
