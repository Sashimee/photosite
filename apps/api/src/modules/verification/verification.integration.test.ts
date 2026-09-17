import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { RequiredDocumentSchema } from '@photoo/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { generateTotpCode } from '../../testing/totp.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `verification-${label}-${randomUUID()}@photoo.test`;
}

// Distinct per-file IP and coordinates (issue #97): shared Redis and DB with
// other integration suites running in parallel.
const FAKE_IP = '10.50.9.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_LAT = 10 + (Number.parseInt(RUN_ID, 16) % 200) / 10;
const RUN_LNG = 10 + (Number.parseInt(RUN_ID, 16) % 150) / 10;

interface DocumentBody {
  id: string;
  documentKey: string;
  virusScanStatus: string;
}

interface CaseBody {
  id: string;
  countryCode: string;
  status: string;
  businessName: string | null;
  vatNumber: string | null;
  businessRegistrationNumber: string | null;
  documents: DocumentBody[];
  submittedAt: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

interface AdminCaseSummaryBody {
  id: string;
  userId: string;
  status: string;
  assignedAdminId: string | null;
  decidedByAdminId: string | null;
  photographer: { displayName: string; email: string };
  documents: DocumentBody[];
  submittedAt: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

interface AdminCasesPage {
  items: AdminCaseSummaryBody[];
  nextCursor: string | null;
}

interface AdminCaseDetailBody {
  id: string;
  userId: string;
  status: string;
  businessName: string | null;
  vatNumber: string | null;
  businessRegistrationNumber: string | null;
  assignedAdminId: string | null;
  decidedByAdminId: string | null;
  documents: (DocumentBody & { downloadUrl?: string })[];
  submittedAt: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

describe('verification integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdProfileIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function signUpVerifyAndSignIn(
    roles: readonly string[],
    label: string,
  ): Promise<{ token: string; id: string; email: string }> {
    const email = uniqueEmail(label);
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD, roles, locale: 'en' },
    });
    const userId = signUpResponse.json<{ user: { id: string } }>().user.id;
    createdUserIds.push(userId);

    const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
    const token = extractFragmentToken(link);
    if (!token) {
      throw new Error(`no token found in verification link: ${link}`);
    }
    await fastify().inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      remoteAddress: FAKE_IP,
      payload: { token },
    });

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } }>();
    return { token: body.session.token, id: body.user.id, email };
  }

  function sessionCookieHeader(response: {
    cookies: { name: string; value: string }[];
  }): string | undefined {
    const cookie = response.cookies.find((candidate) => candidate.name === 'photoo_session');
    return cookie ? `${cookie.name}=${cookie.value}` : undefined;
  }

  // Admin requests use a cookie, not a bearer token: verifyTOTP rotates the
  // session and only forwards the new value as a Set-Cookie header
  // (apps/api/src/modules/auth/auth.controller.ts totpVerify), so a bearer
  // client has no way to recover a usable token after enrolling 2FA.
  async function makeAdmin(label: string, withTwoFactor: boolean) {
    const admin = await signUpVerifyAndSignIn(['client'], label);
    await prisma.user.update({ where: { id: admin.id }, data: { roles: ['admin'] } });

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: FAKE_IP,
      payload: { email: admin.email, password: PASSWORD },
    });
    let cookie = sessionCookieHeader(signInResponse);
    if (!cookie) {
      throw new Error('expected a session cookie on sign-in');
    }

    if (withTwoFactor) {
      const enrollResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/totp/enroll',
        headers: { cookie, origin: 'http://localhost:3000' },
        payload: { password: PASSWORD },
      });
      const { secret } = enrollResponse.json<{ secret: string }>();
      const verifyResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/totp/verify',
        headers: { cookie, origin: 'http://localhost:3000' },
        payload: { code: generateTotpCode(secret) },
      });
      cookie = sessionCookieHeader(verifyResponse) ?? cookie;
    }

    return { headers: { cookie, origin: 'http://localhost:3000' }, id: admin.id };
  }

  async function createPhotographerProfile(token: string, suffix: string) {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      headers: authHeaders(token),
      payload: {
        displayName: `Fx Verify Photog ${suffix}`,
        categories: ['portrait'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx Verify City ${suffix}`,
        countryCode: 'LU',
      },
    });
    const profile = response.json<{ id: string; slug: string }>();
    createdProfileIds.push(profile.id);
    return profile;
  }

  async function requiredDocuments() {
    const country = await prisma.country.findUniqueOrThrow({ where: { code: 'LU' } });
    return RequiredDocumentSchema.array().parse(country.requiredDocuments);
  }

  async function createUpload(ownerId: string, mimeType: string, clean: boolean) {
    return prisma.upload.create({
      data: {
        ownerId,
        purpose: 'verification_document',
        status: clean ? 'clean' : 'uploaded',
        mimeType,
        declaredSizeBytes: 4096,
        actualSizeBytes: 4096,
        objectKey: `fixtures/verification/${randomUUID()}`,
        virusScanStatus: clean ? 'clean' : 'pending',
      },
    });
  }

  // Attach itself now requires a clean scan (matching submit), so every
  // upload created here is clean; a document that regresses after
  // attachment is a separate, direct-DB scenario used by its own test.
  async function attachAllRequiredDocuments(token: string, ownerId: string) {
    const documents = await requiredDocuments();
    for (const document of documents) {
      const upload = await createUpload(
        ownerId,
        document.acceptedMimeTypes[0] ?? 'application/pdf',
        true,
      );
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(token),
        payload: { uploadId: upload.id, documentKey: document.key },
      });
      expect(response.statusCode).toBe(201);
    }
  }

  async function createDraftCase(token: string) {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/verification-case',
      headers: authHeaders(token),
      payload: { businessName: 'Fixture Photography Sàrl' },
    });
    expect(response.statusCode).toBe(201);
    return response.json<CaseBody>();
  }

  async function clearRateLimitKeys(): Promise<void> {
    const exact = createdUserIds.flatMap((id) => [
      `rate-limit:verification:case-create:account:${id}`,
      `lockout:verification:case-create:account:${id}`,
      `rate-limit:verification:case-submit:account:${id}`,
      `lockout:verification:case-submit:account:${id}`,
      `rate-limit:verification:case-update:account:${id}`,
      `lockout:verification:case-update:account:${id}`,
      `rate-limit:verification:case-document-attach:account:${id}`,
      `lockout:verification:case-document-attach:account:${id}`,
      `rate-limit:verification:admin-document-url:admin:${id}`,
      `lockout:verification:admin-document-url:admin:${id}`,
    ]);
    const patterns = [`rate-limit:auth:*:${FAKE_IP}`, `lockout:auth:*:${FAKE_IP}`];
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    const all = [...exact, ...globbed];
    if (all.length > 0) {
      await redis.del(...all);
    }
  }

  // A distinct 2-letter code per run (issue #97): a disabled country fixture
  // for the "disabled country returns 404" case, never colliding with a
  // real seeded country or another suite's fixtures. CountryCodeSchema
  // requires exactly two uppercase letters, so RUN_ID's hex digits are
  // mapped into the A-P range rather than used directly.
  function hexDigitToLetter(hexDigit: string): string {
    return String.fromCharCode(65 + Number.parseInt(hexDigit, 16));
  }
  const DISABLED_COUNTRY_CODE = `${hexDigitToLetter(RUN_ID[0] ?? '0')}${hexDigitToLetter(RUN_ID[1] ?? '1')}`;

  async function fetchAdminCasesPage(
    query: string,
    cursor: string | null,
    headers: Record<string, string | undefined>,
  ): Promise<AdminCasesPage> {
    const cursorParam: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await fastify().inject({
      method: 'GET',
      url: `/v1/admin/verification-cases?${query}${cursorParam}`,
      headers,
    });
    if (response.statusCode !== 200) {
      throw new Error(`admin list failed with status ${String(response.statusCode)}`);
    }
    return response.json<AdminCasesPage>();
  }

  async function fetchAllAdminCases(
    query: string,
    headers: Record<string, string | undefined>,
  ): Promise<AdminCaseSummaryBody[]> {
    const items: AdminCaseSummaryBody[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const result: AdminCasesPage = await fetchAdminCasesPage(query, cursor, headers);
      items.push(...result.items);
      cursor = result.nextCursor;
      if (!cursor) {
        break;
      }
    }
    return items;
  }

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    await clearRateLimitKeys();
    await prisma.country.upsert({
      where: { code: DISABLED_COUNTRY_CODE },
      create: {
        code: DISABLED_COUNTRY_CODE,
        name: 'Fixture Disabled Country',
        enabled: false,
        currency: 'EUR',
        vatRate: 0,
        requiredDocuments: [],
        legalTexts: {},
        defaultLocale: 'en',
      },
      update: { enabled: false },
    });
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.verificationCase.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.upload.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.photographerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.country.deleteMany({ where: { code: DISABLED_COUNTRY_CODE } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/countries/:code/verification-requirements', () => {
    it('returns the required documents for an enabled country', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/countries/LU/verification-requirements',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ countryCode: string; documents: { key: string }[] }>();
      expect(body.countryCode).toBe('LU');
      expect(body.documents.length).toBeGreaterThan(0);
    });

    it('returns 404 for a country that does not exist', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/countries/ZZ/verification-requirements',
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for a disabled country', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/countries/${DISABLED_COUNTRY_CODE}/verification-requirements`,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/me/verification-case', () => {
    it('returns 403 without a photographer profile', async () => {
      const client = await signUpVerifyAndSignIn(['photographer'], 'no-profile');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case',
        headers: authHeaders(client.token),
        payload: {},
      });
      expect(response.statusCode).toBe(403);
    });

    it('rejects a countryCode field from the client', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'reject-country');
      await createPhotographerProfile(photographer.token, 'reject-country');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case',
        headers: authHeaders(photographer.token),
        payload: { countryCode: 'LU' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates a draft case using the profile country, and rejects a second active case', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'create');
      await createPhotographerProfile(photographer.token, 'create');

      const created = await createDraftCase(photographer.token);
      expect(created.status).toBe('draft');
      expect(created.countryCode).toBe('LU');
      expect(created.businessName).toBe('Fixture Photography Sàrl');

      const duplicate = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case',
        headers: authHeaders(photographer.token),
        payload: {},
      });
      expect(duplicate.statusCode).toBe(409);
    });

    it('stores businessName encrypted, not as plaintext', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'encrypted');
      await createPhotographerProfile(photographer.token, 'encrypted');
      const created = await createDraftCase(photographer.token);

      const row = await prisma.verificationCase.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.businessName).not.toBe('Fixture Photography Sàrl');
      expect(row.businessName).not.toContain('Fixture Photography');
      expect(row.businessName).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    });

    it('hits the 5-per-day create rate limit', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'rate-limit-create');
      await createPhotographerProfile(photographer.token, 'rate-limit-create');

      let lastStatus = 0;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (attempt > 0) {
          await prisma.verificationCase.updateMany({
            where: { userId: photographer.id },
            data: { status: 'rejected' },
          });
        }
        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/me/verification-case',
          headers: authHeaders(photographer.token),
          payload: {},
        });
        lastStatus = response.statusCode;
      }
      expect(lastStatus).toBe(429);
    });
  });

  describe('documents and submit', () => {
    it('rejects an unknown documentKey with 422', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'bad-key');
      await createPhotographerProfile(photographer.token, 'bad-key');
      await createDraftCase(photographer.token);
      const upload = await createUpload(photographer.id, 'application/pdf', true);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: upload.id, documentKey: 'not_a_real_document' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects a mime type not accepted for the document with 422', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'bad-mime');
      await createPhotographerProfile(photographer.token, 'bad-mime');
      await createDraftCase(photographer.token);
      const [firstDocument] = await requiredDocuments();
      if (!firstDocument) throw new Error('no required documents configured for LU');
      const upload = await createUpload(photographer.id, 'application/zip', true);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: upload.id, documentKey: firstDocument.key },
      });
      expect(response.statusCode).toBe(422);
    });

    it("rejects another user's upload with 422", async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'foreign-upload');
      await createPhotographerProfile(photographer.token, 'foreign-upload');
      await createDraftCase(photographer.token);
      const stranger = await signUpVerifyAndSignIn(['client'], 'stranger');
      const [firstDocument] = await requiredDocuments();
      if (!firstDocument) throw new Error('no required documents configured for LU');
      const upload = await createUpload(
        stranger.id,
        firstDocument.acceptedMimeTypes[0] ?? 'application/pdf',
        true,
      );

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: upload.id, documentKey: firstDocument.key },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects attaching an upload that has not been scanned clean with 422', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'unclean-attach');
      await createPhotographerProfile(photographer.token, 'unclean-attach');
      await createDraftCase(photographer.token);
      const [firstDocument] = await requiredDocuments();
      if (!firstDocument) throw new Error('no required documents configured for LU');
      const upload = await createUpload(
        photographer.id,
        firstDocument.acceptedMimeTypes[0] ?? 'application/pdf',
        false,
      );

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: upload.id, documentKey: firstDocument.key },
      });
      expect(response.statusCode).toBe(422);
    });

    it('replaces the previous document when the same key is re-attached, expiring the old upload', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'reattach');
      await createPhotographerProfile(photographer.token, 'reattach');
      await createDraftCase(photographer.token);
      const [firstDocument] = await requiredDocuments();
      if (!firstDocument) throw new Error('no required documents configured for LU');
      const mimeType = firstDocument.acceptedMimeTypes[0] ?? 'application/pdf';

      const firstUpload = await createUpload(photographer.id, mimeType, true);
      const firstAttach = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: firstUpload.id, documentKey: firstDocument.key },
      });
      expect(firstAttach.statusCode).toBe(201);

      const secondUpload = await createUpload(photographer.id, mimeType, true);
      const secondAttach = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: secondUpload.id, documentKey: firstDocument.key },
      });
      expect(secondAttach.statusCode).toBe(201);
      expect(secondAttach.json<DocumentBody>().id).not.toBe(firstAttach.json<DocumentBody>().id);

      const documents = await prisma.verificationDocument.findMany({
        where: { uploadId: { in: [firstUpload.id, secondUpload.id] } },
      });
      expect(documents).toHaveLength(1);
      expect(documents[0]?.uploadId).toBe(secondUpload.id);

      const oldUpload = await prisma.upload.findUniqueOrThrow({ where: { id: firstUpload.id } });
      expect(oldUpload.status).toBe('failed');
      expect(oldUpload.expiresAt).not.toBeNull();
    });

    it('rejects attaching an upload already attached to another document with 422', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'dup-upload');
      await createPhotographerProfile(photographer.token, 'dup-upload');
      await createDraftCase(photographer.token);
      const documents = await requiredDocuments();
      const [firstDocument, secondDocument] = documents;
      if (!firstDocument || !secondDocument) {
        throw new Error('need at least two required documents for LU');
      }
      const upload = await createUpload(
        photographer.id,
        firstDocument.acceptedMimeTypes[0] ?? 'application/pdf',
        true,
      );

      const firstAttach = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: upload.id, documentKey: firstDocument.key },
      });
      expect(firstAttach.statusCode).toBe(201);

      const secondAttach = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: upload.id, documentKey: secondDocument.key },
      });
      expect(secondAttach.statusCode).toBe(422);
    });

    it('blocks submit while a required document is not yet scanned clean', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'unclean');
      await createPhotographerProfile(photographer.token, 'unclean');
      const created = await createDraftCase(photographer.token);
      await attachAllRequiredDocuments(photographer.token, photographer.id);

      const [firstDocument] = await requiredDocuments();
      if (!firstDocument) throw new Error('no required documents configured for LU');
      const documentRow = await prisma.verificationDocument.findFirstOrThrow({
        where: { caseId: created.id, documentKey: firstDocument.key },
      });
      await prisma.upload.update({
        where: { id: documentRow.uploadId },
        data: { virusScanStatus: 'pending' },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/submit',
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(422);
    });

    it('submits successfully once every document is clean, and sets the profile to pending', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'submit-ok');
      const profile = await createPhotographerProfile(photographer.token, 'submit-ok');
      await createDraftCase(photographer.token);
      await attachAllRequiredDocuments(photographer.token, photographer.id);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/submit',
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<CaseBody>();
      expect(body.status).toBe('submitted');
      expect(body.submittedAt).not.toBeNull();

      const updatedProfile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });
      expect(updatedProfile.verificationStatus).toBe('pending');

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'verification_case.submitted', targetId: body.id },
      });
      expect(auditRow).not.toBeNull();
    });

    it('is immutable after submit: attaching a document or updating the case returns 409', async () => {
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'immutable');
      await createPhotographerProfile(photographer.token, 'immutable');
      await createDraftCase(photographer.token);
      await attachAllRequiredDocuments(photographer.token, photographer.id);
      await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/submit',
        headers: authHeaders(photographer.token),
      });

      const [firstDocument] = await requiredDocuments();
      if (!firstDocument) throw new Error('no required documents configured for LU');
      const extraUpload = await createUpload(
        photographer.id,
        firstDocument.acceptedMimeTypes[0] ?? 'application/pdf',
        true,
      );
      const attachResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/documents',
        headers: authHeaders(photographer.token),
        payload: { uploadId: extraUpload.id, documentKey: firstDocument.key },
      });
      expect(attachResponse.statusCode).toBe(409);

      const updateResponse = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/verification-case',
        headers: authHeaders(photographer.token),
        payload: { businessName: 'Renamed Sàrl' },
      });
      expect(updateResponse.statusCode).toBe(409);
    });
  });

  describe('admin review', () => {
    async function createSubmittedCase(label: string) {
      const photographer = await signUpVerifyAndSignIn(['photographer'], label);
      const profile = await createPhotographerProfile(photographer.token, label);
      const created = await createDraftCase(photographer.token);
      await attachAllRequiredDocuments(photographer.token, photographer.id);
      const submitResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case/submit',
        headers: authHeaders(photographer.token),
      });
      expect(submitResponse.statusCode).toBe(200);
      return { photographer, profile, caseId: created.id };
    }

    it('returns 403 for a non-admin', async () => {
      const client = await signUpVerifyAndSignIn(['client'], 'non-admin');
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/verification-cases',
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns TWO_FACTOR_REQUIRED for an admin without a verified second factor', async () => {
      const admin = await makeAdmin('no-2fa', false);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/verification-cases',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('TWO_FACTOR_REQUIRED');
    });

    it('returns TWO_FACTOR_REQUIRED once the two-factor verification window has expired', async () => {
      const admin = await makeAdmin('expired-2fa', true);
      await prisma.session.updateMany({
        where: { userId: admin.id },
        data: { twoFactorVerifiedAt: new Date(Date.now() - 13 * 60 * 60 * 1000) },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/verification-cases',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('TWO_FACTOR_REQUIRED');
    });

    it('passes with a second factor verified within the window', async () => {
      const admin = await makeAdmin('fresh-2fa', true);
      await prisma.session.updateMany({
        where: { userId: admin.id },
        data: { twoFactorVerifiedAt: new Date(Date.now() - 1 * 60 * 60 * 1000) },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/verification-cases',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
    });

    it('lists, reviews, approves and audits a submitted case', async () => {
      const { photographer, profile, caseId } = await createSubmittedCase('approve-flow');
      const admin = await makeAdmin('approve-flow-admin', true);

      const listItems = await fetchAllAdminCases('status=submitted', admin.headers);
      const listItem = listItems.find((item) => item.id === caseId);
      expect(listItem).toBeDefined();
      expect(listItem?.photographer.displayName).toBe(`Fx Verify Photog approve-flow`);
      expect(listItem?.photographer.email).toBe(photographer.email);
      expect('businessName' in (listItem as unknown as Record<string, unknown>)).toBe(false);
      expect('vatNumber' in (listItem as unknown as Record<string, unknown>)).toBe(false);
      expect('businessRegistrationNumber' in (listItem as unknown as Record<string, unknown>)).toBe(
        false,
      );
      expect(listItem?.documents[0] && 'downloadUrl' in listItem.documents[0]).toBe(false);

      const getResponse = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/verification-cases/${caseId}`,
        headers: admin.headers,
      });
      expect(getResponse.statusCode).toBe(200);
      const getBody = getResponse.json<AdminCaseDetailBody>();
      expect(getBody.businessName).toBe('Fixture Photography Sàrl');
      expect(getBody.documents.length).toBeGreaterThan(0);
      for (const document of getBody.documents) {
        expect(document.downloadUrl).toContain('http');
      }

      const accessAudit = await prisma.auditLog.findFirst({
        where: { action: 'verification_case.documents_accessed', targetId: caseId },
      });
      expect(accessAudit).not.toBeNull();

      const startReviewResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/verification-cases/${caseId}/start-review`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
      });
      expect(startReviewResponse.statusCode).toBe(200);
      expect(startReviewResponse.json<AdminCaseSummaryBody>().status).toBe('in_review');

      const startReviewAudit = await prisma.auditLog.findFirst({
        where: { action: 'verification_case.review_started', targetId: caseId },
      });
      expect(startReviewAudit?.ip).toBe(FAKE_IP);

      const secondStartReview = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/verification-cases/${caseId}/start-review`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
      });
      expect(secondStartReview.statusCode).toBe(409);

      const approveResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/verification-cases/${caseId}/approve`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
      });
      expect(approveResponse.statusCode).toBe(200);
      expect(approveResponse.json<AdminCaseSummaryBody>().status).toBe('approved');

      const secondApprove = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/verification-cases/${caseId}/approve`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
      });
      expect(secondApprove.statusCode).toBe(409);

      const updatedProfile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });
      expect(updatedProfile.verificationStatus).toBe('verified');
      expect(updatedProfile.isPublished).toBe(false);

      const approveAudit = await prisma.auditLog.findFirst({
        where: { action: 'verification_case.approved', targetId: caseId },
      });
      expect(approveAudit).not.toBeNull();
      expect(approveAudit?.ip).toBe(FAKE_IP);

      const notification = await prisma.notification.findFirst({
        where: { userId: photographer.id, type: 'verification_approved' },
      });
      expect(notification).not.toBeNull();
      expect(notification?.channels).not.toContain('push');
    });

    it('omits the download link for a document whose upload has not been scanned clean', async () => {
      const { caseId } = await createSubmittedCase('unclean-detail');
      const document = await prisma.verificationDocument.findFirstOrThrow({
        where: { caseId },
      });
      await prisma.upload.update({
        where: { id: document.uploadId },
        data: { virusScanStatus: 'pending', status: 'uploaded' },
      });

      const admin = await makeAdmin('unclean-detail-admin', true);
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/verification-cases/${caseId}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<AdminCaseDetailBody>();
      const target = body.documents.find((candidate) => candidate.id === document.id);
      expect(target?.downloadUrl).toBeUndefined();
    });

    it('pages through the queue with limit=1 in submittedAt order, with no gaps or repeats', async () => {
      const admin = await makeAdmin('pagination-admin', true);
      const first = await createSubmittedCase('page-1');
      const second = await createSubmittedCase('page-2');
      const third = await createSubmittedCase('page-3');

      const items: AdminCaseSummaryBody[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page += 1) {
        const result: AdminCasesPage = await fetchAdminCasesPage(
          'status=submitted&limit=1',
          cursor,
          admin.headers,
        );
        expect(result.items.length).toBeLessThanOrEqual(1);
        items.push(...result.items);
        cursor = result.nextCursor;
        if (!cursor) {
          break;
        }
      }

      const ids = items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      const positions = [first.caseId, second.caseId, third.caseId].map((id) => ids.indexOf(id));
      expect(positions.every((position) => position !== -1)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });

    it('returns 400 for a cursor that is not valid base64url JSON', async () => {
      const admin = await makeAdmin('bad-cursor-admin', true);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/verification-cases?cursor=not-base64!!!',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a case, records the reason, and unpublishes a previously verified profile', async () => {
      const { photographer, profile, caseId } = await createSubmittedCase('reject-flow');
      await prisma.photographerProfile.update({
        where: { id: profile.id },
        data: {
          verificationStatus: 'verified',
          stripePayoutsEnabled: true,
          stripeAccountId: `acct_${profile.id}`,
          stripeOnboardingComplete: true,
          isPublished: true,
        },
      });

      const admin = await makeAdmin('reject-flow-admin', true);
      await fastify().inject({
        method: 'POST',
        url: `/v1/admin/verification-cases/${caseId}/start-review`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
      });

      const rejectResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/verification-cases/${caseId}/reject`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { reason: 'Business registration document is illegible' },
      });
      expect(rejectResponse.statusCode).toBe(200);
      expect(rejectResponse.json<AdminCaseSummaryBody>().status).toBe('rejected');

      const updatedProfile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });
      expect(updatedProfile.verificationStatus).toBe('rejected');
      expect(updatedProfile.isPublished).toBe(false);

      const rejectAudit = await prisma.auditLog.findFirst({
        where: { action: 'verification_case.rejected', targetId: caseId },
      });
      expect(rejectAudit).not.toBeNull();
      expect(rejectAudit?.ip).toBe(FAKE_IP);

      const notification = await prisma.notification.findFirst({
        where: { userId: photographer.id, type: 'verification_rejected' },
      });
      expect(notification).not.toBeNull();
      expect((notification?.payload as { reason?: string } | null)?.reason).toBe(
        'Business registration document is illegible',
      );

      const ownCaseResponse = await fastify().inject({
        method: 'GET',
        url: '/v1/me/verification-case',
        headers: authHeaders(photographer.token),
      });
      expect(ownCaseResponse.statusCode).toBe(200);
      const ownCase = ownCaseResponse.json<CaseBody>();
      expect(ownCase.id).toBe(caseId);
      expect(ownCase.status).toBe('rejected');
      expect(ownCase.rejectionReason).toBe('Business registration document is illegible');

      const freshDraftResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/me/verification-case',
        headers: authHeaders(photographer.token),
        payload: {},
      });
      expect(freshDraftResponse.statusCode).toBe(201);
      const freshDraft = freshDraftResponse.json<CaseBody>();
      expect(freshDraft.id).not.toBe(caseId);
      expect(freshDraft.status).toBe('draft');
    });

    it('rejects an empty reason with 400', async () => {
      const { caseId } = await createSubmittedCase('reject-bad-reason');
      const admin = await makeAdmin('reject-bad-reason-admin', true);
      await fastify().inject({
        method: 'POST',
        url: `/v1/admin/verification-cases/${caseId}/start-review`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/verification-cases/${caseId}/reject`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { reason: '' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for an unknown case id', async () => {
      const admin = await makeAdmin('not-found-admin', true);
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/verification-cases/${randomUUID()}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
