import { describe, expect, it } from 'vitest';
import { formatHtml, formatText } from './format-message.js';

describe('formatText', () => {
  it('substitutes every placeholder with its raw value', () => {
    expect(formatText('Hello {name}, total {total}', { name: 'Jane', total: '€10' })).toBe(
      'Hello Jane, total €10',
    );
  });

  it('throws when a placeholder has no value', () => {
    expect(() => formatText('Hello {name}', {})).toThrow(/name/);
  });
});

describe('formatHtml', () => {
  it('HTML-escapes every interpolated value', () => {
    const result = formatHtml('{name} sent you a quote', { name: '<b>Evil</b> & Co' });
    expect(result).toBe('&lt;b&gt;Evil&lt;/b&gt; &amp; Co sent you a quote');
  });

  it('leaves the surrounding template text unescaped', () => {
    const result = formatHtml('<p>{name}</p>', { name: 'Jane' });
    expect(result).toBe('<p>Jane</p>');
  });
});
