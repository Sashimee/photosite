import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireRole } from './require-role.js';

describe('requireRole', () => {
  it('does not throw when the user has the role', () => {
    expect(() => {
      requireRole({ roles: ['photographer'] }, 'photographer');
    }).not.toThrow();
  });

  it('throws a 403 when the user lacks the role', () => {
    expect(() => {
      requireRole({ roles: ['client'] }, 'photographer');
    }).toThrow(HttpException);
    try {
      requireRole({ roles: ['client'] }, 'photographer');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(403);
    }
  });
});
