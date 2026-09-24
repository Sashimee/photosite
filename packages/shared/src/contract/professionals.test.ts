import { describe, expect, it } from 'vitest';
import {
  CreateProfessionalProfileRequestSchema,
  OwnProfessionalProfileSchema,
  PublicProfessionalCompanySchema,
  UpdateProfessionalProfileRequestSchema,
} from './professionals.js';

const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('CreateProfessionalProfileRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(
      CreateProfessionalProfileRequestSchema.safeParse({
        companyName: 'Studio Doe s.à r.l.',
        website: 'https://studio-doe.lu',
        vatNumber: 'LU12345678',
        logoUploadId: id,
      }).success,
    ).toBe(true);
  });

  it('accepts just a companyName', () => {
    expect(
      CreateProfessionalProfileRequestSchema.safeParse({ companyName: 'Studio Doe' }).success,
    ).toBe(true);
  });

  it('accepts null website and vatNumber', () => {
    expect(
      CreateProfessionalProfileRequestSchema.safeParse({
        companyName: 'Studio Doe',
        website: null,
        vatNumber: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a javascript: website', () => {
    expect(
      CreateProfessionalProfileRequestSchema.safeParse({
        companyName: 'Studio Doe',
        website: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty companyName', () => {
    expect(CreateProfessionalProfileRequestSchema.safeParse({ companyName: '' }).success).toBe(
      false,
    );
  });

  it('rejects a verified field on create', () => {
    expect(
      CreateProfessionalProfileRequestSchema.safeParse({
        companyName: 'Studio Doe',
        verified: true,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      CreateProfessionalProfileRequestSchema.safeParse({
        companyName: 'Studio Doe',
        phone: '+352000000',
      }).success,
    ).toBe(false);
  });
});

describe('UpdateProfessionalProfileRequestSchema', () => {
  it('accepts an empty patch', () => {
    expect(UpdateProfessionalProfileRequestSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a verified field', () => {
    expect(UpdateProfessionalProfileRequestSchema.safeParse({ verified: true }).success).toBe(
      false,
    );
  });
});

describe('PublicProfessionalCompanySchema', () => {
  const validCompany = {
    id,
    companyName: 'Studio Doe s.à r.l.',
    website: 'https://studio-doe.lu',
    logoUrl: 'https://cdn.photoo.lu/logos/abc123.png',
    verified: true,
  };

  it('accepts a well-formed public company', () => {
    expect(PublicProfessionalCompanySchema.safeParse(validCompany).success).toBe(true);
  });

  it('rejects a vatNumber field', () => {
    expect(
      PublicProfessionalCompanySchema.safeParse({ ...validCompany, vatNumber: 'LU12345678' })
        .success,
    ).toBe(false);
  });

  it('rejects an email field', () => {
    expect(
      PublicProfessionalCompanySchema.safeParse({ ...validCompany, email: 'a@b.com' }).success,
    ).toBe(false);
  });

  it('rejects a phone field', () => {
    expect(
      PublicProfessionalCompanySchema.safeParse({ ...validCompany, phone: '+352000000' }).success,
    ).toBe(false);
  });
});

describe('OwnProfessionalProfileSchema', () => {
  it('accepts vatNumber alongside the public fields', () => {
    expect(
      OwnProfessionalProfileSchema.safeParse({
        id,
        companyName: 'Studio Doe',
        website: null,
        logoUrl: null,
        verified: false,
        vatNumber: 'LU12345678',
      }).success,
    ).toBe(true);
  });
});
