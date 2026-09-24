import { describe, expect, it } from 'vitest';

import {
  buildApplyPayload,
  mapApplyIssuePath,
  mapValidationErrorDetailPath,
} from './apply-form-helpers';

describe('buildApplyPayload', () => {
  it('trims the message and sends null for a blank portfolio link', () => {
    expect(buildApplyPayload({ message: '  Hello  ', portfolioLink: '   ' })).toEqual({
      message: 'Hello',
      portfolioLink: null,
    });
  });

  it('trims a provided portfolio link', () => {
    expect(
      buildApplyPayload({ message: 'Hello', portfolioLink: '  https://example.com  ' }),
    ).toEqual({ message: 'Hello', portfolioLink: 'https://example.com' });
  });
});

describe('mapApplyIssuePath', () => {
  it('maps known top-level fields', () => {
    expect(mapApplyIssuePath(['message'])).toBe('message');
    expect(mapApplyIssuePath(['portfolioLink'])).toBe('portfolioLink');
  });

  it('returns null for an unknown field', () => {
    expect(mapApplyIssuePath(['somethingElse'])).toBeNull();
  });
});

describe('mapValidationErrorDetailPath', () => {
  it('maps a dot-joined API detail path onto a form field', () => {
    expect(mapValidationErrorDetailPath([{ path: 'message' }])).toEqual(['message']);
  });

  it('returns an empty array when details is not an array', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
    expect(mapValidationErrorDetailPath(null)).toEqual([]);
  });

  it('maps an unrecognised detail entry to null', () => {
    expect(mapValidationErrorDetailPath([{ path: 'nope' }, 'not-an-object'])).toEqual([null, null]);
  });
});
