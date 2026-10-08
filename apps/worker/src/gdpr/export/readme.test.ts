import { describe, expect, it } from 'vitest';
import { buildReadmeText } from './readme.js';

describe('buildReadmeText', () => {
  it('mentions the manual route for verification documents', () => {
    const text = buildReadmeText();

    expect(text).toContain('contact support');
    expect(text).toContain('messages.json');
  });

  it('mentions the provenance field of portfolio images', () => {
    expect(buildReadmeText()).toContain('provenance field');
  });
});
