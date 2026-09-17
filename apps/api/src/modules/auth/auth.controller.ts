import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  AddRoleRequestSchema,
  ConfirmPasswordResetRequestSchema,
  RequestPasswordResetRequestSchema,
  SIGNUP_ROLES,
  SignInRequestSchema,
  SignInTotpRequestSchema,
  SignUpRequestSchema,
  TotpDisableRequestSchema,
  TotpEnrollRequestSchema,
  TotpVerifyRequestSchema,
  VerifyEmailRequestSchema,
  type UserRole,
} from '@photoo/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { AuditLogService } from '../../common/audit/audit-log.service.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { Env } from '../../config/env.js';
import { APP_CONFIG } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ChatSocketBridge } from '../chat/chat-socket-bridge.js';
import { applyFetchResponse, rethrowAsHttpException, toFetchHeaders } from './auth-http.js';
import { AUTH_INSTANCE } from './auth-instance.provider.js';
import type { Auth } from './auth-instance.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { checkPasswordCompromised } from './hibp.js';
import { isOAuthProvider, isProviderConfigured } from './oauth-providers.js';
import { OriginGuard } from './origin-guard.js';
import { requireSession, type BetterAuthUserRow } from './session.js';
import { mapUser } from './user-mapper.js';

interface BetterAuthSessionRow {
  expiresAt: string | Date;
}

function emailLocalPart(email: string): string {
  const [localPart] = email.split('@');
  return localPart && localPart.length > 0 ? localPart : email;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Controller('auth')
@UseGuards(OriginGuard)
export class AuthController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(APP_CONFIG) private readonly config: Env,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(AuthRateLimitService) private readonly rateLimit: AuthRateLimitService,
    @Inject(ChatSocketBridge) private readonly chatSocketBridge: ChatSocketBridge,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  private async signedInBody(
    token: string,
    headers: Headers,
  ): Promise<{ user: ReturnType<typeof mapUser>; session: { token: string; expiresAt: string } }> {
    const lookupHeaders = new Headers(headers);
    lookupHeaders.set('authorization', `Bearer ${token}`);
    const session = await this.auth.api.getSession({ headers: lookupHeaders });
    if (!session) {
      throw new HttpException(
        { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
        500,
      );
    }
    return {
      user: mapUser(session.user as unknown as BetterAuthUserRow),
      session: {
        token,
        expiresAt: toIsoString((session.session as unknown as BetterAuthSessionRow).expiresAt),
      },
    };
  }

  private async defaultCountryCode(): Promise<string> {
    const country = await this.prisma.client.country.findFirst({
      where: { enabled: true },
      orderBy: { code: 'asc' },
    });
    if (!country) {
      throw new HttpException(
        { code: 'NO_COUNTRY_CONFIGURED', message: 'No enabled country is configured' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return country.code;
  }

  @Post('sign-up')
  async signUp(
    @Body(new ZodValidationPipe(SignUpRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const input = body as { email: string; password: string; roles: UserRole[]; locale: string };
    await this.rateLimit.enforce('sign-up', request.ip);

    const compromised = await checkPasswordCompromised(input.password, this.logger);
    if (compromised) {
      throw new HttpException(
        {
          code: 'PASSWORD_COMPROMISED',
          message: 'This password has appeared in a data breach. Choose a different password.',
        },
        400,
      );
    }

    const countryCode = await this.defaultCountryCode();
    try {
      const response = await this.auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: emailLocalPart(input.email),
          roles: input.roles,
          locale: input.locale,
          countryCode,
        },
        headers: toFetchHeaders(request),
        asResponse: true,
      });
      const parsed = await applyFetchResponse<{ user: BetterAuthUserRow }>(response, reply);
      reply.status(201);
      reply.send({ user: mapUser(parsed.user) });
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @Post('sign-in')
  async signIn(
    @Body(new ZodValidationPipe(SignInRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const input = body as { email: string; password: string };
    const accountKey = input.email.trim().toLowerCase();
    await this.rateLimit.enforce('sign-in', request.ip, accountKey);

    try {
      const response = await this.auth.api.signInEmail({
        body: { email: input.email, password: input.password },
        headers: toFetchHeaders(request),
        asResponse: true,
      });
      const parsed = await applyFetchResponse<{
        user: BetterAuthUserRow;
        token: string | null;
        twoFactorRedirect?: boolean;
      }>(response, reply);

      if (parsed.twoFactorRedirect || !parsed.token) {
        reply.status(200);
        reply.send({ twoFactorRequired: true });
        return;
      }

      await this.rateLimit.resetAccount('sign-in', accountKey);
      const body2 = await this.signedInBody(parsed.token, toFetchHeaders(request));
      reply.status(200);
      reply.send(body2);
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @Post('sign-in/totp')
  async signInTotp(
    @Body(new ZodValidationPipe(SignInTotpRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const input = body as { code?: string; backupCode?: string };
    await this.rateLimit.enforce('sign-in-totp', request.ip);
    const headers = toFetchHeaders(request);
    try {
      const response = input.code
        ? await this.auth.api.verifyTOTP({ body: { code: input.code }, headers, asResponse: true })
        : await this.auth.api.verifyBackupCode({
            body: { code: input.backupCode ?? '' },
            headers,
            asResponse: true,
          });
      const parsed = await applyFetchResponse<{ token: string }>(response, reply);
      const responseBody = await this.signedInBody(parsed.token, headers);
      reply.status(200);
      reply.send(responseBody);
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @Post('sign-out')
  async signOut(
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const { user } = await requireSession(this.auth, request);
    try {
      const response = await this.auth.api.signOut({
        headers: toFetchHeaders(request),
        asResponse: true,
      });
      await applyFetchResponse(response, reply);
      // Sockets only carry a userId (M1), so this drops every chat socket
      // for the user rather than the single revoked session.
      this.chatSocketBridge.disconnectUser(user.id);
      reply.status(204);
      reply.send();
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @Post('sessions/revoke-all')
  async revokeAllSessions(
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const { user, headers } = await requireSession(this.auth, request);
    try {
      const response = await this.auth.api.revokeSessions({ headers, asResponse: true });
      await applyFetchResponse(response, reply);
      this.chatSocketBridge.disconnectUser(user.id);
      reply.status(204);
      reply.send();
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @Get('session')
  async session(@Req() request: FastifyRequest): Promise<{ user: ReturnType<typeof mapUser> }> {
    const { user } = await requireSession(this.auth, request);
    return { user: mapUser(user) };
  }

  @Post('verify-email')
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const input = body as { token: string };
    await this.rateLimit.enforce('verify-email', request.ip);
    const originalHeaders = toFetchHeaders(request);
    try {
      const response = await this.auth.api.verifyEmail({
        query: { token: input.token },
        headers: originalHeaders,
        asResponse: true,
      });
      const setCookies =
        typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      if (setCookies.length > 0) {
        reply.raw.setHeader('set-cookie', setCookies);
      }
      const lookupHeaders = new Headers(originalHeaders);
      if (setCookies.length > 0) {
        lookupHeaders.set('cookie', setCookies.map((cookie) => cookie.split(';')[0]).join('; '));
      }
      const session = await this.auth.api.getSession({ headers: lookupHeaders });
      if (!session) {
        throw new HttpException(
          { code: 'UNAUTHORIZED', message: 'Email verified but no session could be created' },
          401,
        );
      }
      reply.status(200);
      reply.send({ user: mapUser(session.user as unknown as BetterAuthUserRow) });
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @Post('password-reset/request')
  @HttpCode(202)
  async requestPasswordReset(
    @Body(new ZodValidationPipe(RequestPasswordResetRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ message: string }> {
    const input = body as { email: string };
    const accountKey = input.email.trim().toLowerCase();
    await this.rateLimit.enforce('password-reset-request', request.ip, accountKey);
    try {
      await this.auth.api.requestPasswordReset({
        body: { email: input.email },
        headers: toFetchHeaders(request),
      });
    } catch (error) {
      rethrowAsHttpException(error);
    }
    return { message: 'If an account exists, a reset email has been sent.' };
  }

  @HttpCode(200)
  @Post('password-reset/confirm')
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(ConfirmPasswordResetRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ message: string }> {
    const input = body as { token: string; password: string };
    await this.rateLimit.enforce('password-reset-confirm', request.ip);

    const compromised = await checkPasswordCompromised(input.password, this.logger);
    if (compromised) {
      throw new HttpException(
        {
          code: 'PASSWORD_COMPROMISED',
          message: 'This password has appeared in a data breach. Choose a different password.',
        },
        400,
      );
    }

    try {
      await this.auth.api.resetPassword({
        body: { newPassword: input.password, token: input.token },
        headers: toFetchHeaders(request),
      });
    } catch (error) {
      rethrowAsHttpException(error);
    }
    return { message: 'Password updated.' };
  }

  @HttpCode(200)
  @Post('roles')
  async addRole(
    @Body(new ZodValidationPipe(AddRoleRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ user: ReturnType<typeof mapUser> }> {
    const input = body as { role: UserRole };
    const { user } = await requireSession(this.auth, request);

    if (!SIGNUP_ROLES.includes(input.role as (typeof SIGNUP_ROLES)[number])) {
      throw new HttpException(
        { code: 'BAD_REQUEST', message: 'Role cannot be self-assigned' },
        400,
      );
    }
    if (user.roles.includes(input.role)) {
      throw new HttpException(
        { code: 'ROLE_ALREADY_ASSIGNED', message: 'Role already assigned' },
        409,
      );
    }

    const before = { roles: user.roles };
    const nextRoles = [...user.roles, input.role];

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { roles: { set: nextRoles as never } },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'user.role_added',
          targetType: 'User',
          targetId: user.id,
          before,
          after: { roles: nextRoles },
          ip: request.ip,
        },
      });
      return updatedUser;
    });

    return { user: mapUser(updated) };
  }

  @HttpCode(200)
  @Post('totp/enroll')
  async totpEnroll(
    @Body(new ZodValidationPipe(TotpEnrollRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ secret: string; otpauthUrl: string; backupCodes: string[] }> {
    const input = body as { password: string };
    const { user } = await requireSession(this.auth, request);
    await this.rateLimit.enforce('totp-enroll', request.ip, user.id);
    try {
      const result = await this.auth.api.enableTwoFactor({
        body: { password: input.password, method: 'totp', issuer: 'photoo.lu' },
        headers: toFetchHeaders(request),
      });
      if (!('totpURI' in result)) {
        throw new HttpException(
          { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
          500,
        );
      }
      const secretMatch = /[?&]secret=([^&]+)/.exec(result.totpURI);
      const secret = secretMatch ? decodeURIComponent(secretMatch[1] ?? '') : '';
      return { secret, otpauthUrl: result.totpURI, backupCodes: result.backupCodes };
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @Post('totp/verify')
  async totpVerify(
    @Body(new ZodValidationPipe(TotpVerifyRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const input = body as { code: string };
    const { user } = await requireSession(this.auth, request);
    await this.rateLimit.enforce('totp-verify', request.ip, user.id);
    try {
      const response = await this.auth.api.verifyTOTP({
        body: { code: input.code },
        headers: toFetchHeaders(request),
        asResponse: true,
      });
      // verifyTOTP's response embeds the pre-update `twoFactorEnabled` and,
      // on first verification, rotates the session (invalidating this
      // request's own bearer token/cookie), so the user is built from the
      // pre-fetched value above rather than a post-call lookup.
      await applyFetchResponse(response, reply);
      reply.status(200);
      reply.send({ user: mapUser({ ...user, twoFactorEnabled: true }) });
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @HttpCode(200)
  @Post('totp/disable')
  async totpDisable(
    @Body(new ZodValidationPipe(TotpDisableRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ user: ReturnType<typeof mapUser> }> {
    const input = body as { code: string; password: string };
    const { user, headers } = await requireSession(this.auth, request);
    await this.rateLimit.enforce('totp-disable', request.ip, user.id);
    try {
      await this.auth.api.verifyTOTP({ body: { code: input.code }, headers });
      await this.auth.api.disableTwoFactor({
        body: { password: input.password },
        headers,
      });
      await this.auditLog.record({
        actorType: 'user',
        actorId: user.id,
        action: 'user.totp_disabled',
        targetType: 'User',
        targetId: user.id,
        ip: request.ip,
      });
      return { user: mapUser({ ...user, twoFactorEnabled: false }) };
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }

  @Get('oauth/google/start')
  oauthStartGoogle(
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    return this.oauthStart('google', request, reply);
  }

  @Get('oauth/apple/start')
  oauthStartApple(
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    return this.oauthStart('apple', request, reply);
  }

  @Get('oauth/facebook/start')
  oauthStartFacebook(
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    return this.oauthStart('facebook', request, reply);
  }

  @Get('oauth/microsoft/start')
  oauthStartMicrosoft(
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    return this.oauthStart('microsoft', request, reply);
  }

  private async oauthStart(
    provider: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!isOAuthProvider(provider)) {
      throw new HttpException({ code: 'NOT_FOUND', message: 'Unknown provider' }, 404);
    }
    if (!isProviderConfigured(provider, this.config)) {
      throw new HttpException(
        { code: 'PROVIDER_NOT_CONFIGURED', message: `${provider} sign-in is not configured` },
        404,
      );
    }
    const webOrigin = this.config.WEB_ORIGINS[0] ?? '';
    try {
      const result = await this.auth.api.signInSocial({
        body: { provider, callbackURL: `${webOrigin}/` },
        headers: toFetchHeaders(request),
      });
      if (!result.url) {
        throw new HttpException(
          { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
          500,
        );
      }
      reply.redirect(result.url, 302);
    } catch (error) {
      rethrowAsHttpException(error);
    }
  }
}
