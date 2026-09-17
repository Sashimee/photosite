import { describe, expect, it } from 'vitest';
import { publicVariantUrl } from './public-url.js';

describe('publicVariantUrl', () => {
  it('joins the base URL and the variant key', () => {
    expect(
      publicVariantUrl(
        'http://localhost:9000/photoo-public',
        { thumb_jpeg: 'v/abc/thumb.jpg' },
        'thumb_jpeg',
      ),
    ).toBe('http://localhost:9000/photoo-public/v/abc/thumb.jpg');
  });

  it('strips a trailing slash from the base URL', () => {
    expect(
      publicVariantUrl(
        'http://localhost:9000/photoo-public/',
        { thumb_jpeg: 'v/abc/thumb.jpg' },
        'thumb_jpeg',
      ),
    ).toBe('http://localhost:9000/photoo-public/v/abc/thumb.jpg');
  });

  it('returns null when the variant key is missing', () => {
    expect(
      publicVariantUrl('http://localhost:9000/photoo-public', { medium_jpeg: 'x' }, 'thumb_jpeg'),
    ).toBeNull();
  });

  it('returns null when variants is null', () => {
    expect(publicVariantUrl('http://localhost:9000/photoo-public', null, 'thumb_jpeg')).toBeNull();
  });

  it('returns null when variants is undefined', () => {
    expect(
      publicVariantUrl('http://localhost:9000/photoo-public', undefined, 'thumb_jpeg'),
    ).toBeNull();
  });
});
