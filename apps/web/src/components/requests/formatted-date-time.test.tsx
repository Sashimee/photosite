import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormattedDateTime } from './formatted-date-time';

describe('FormattedDateTime', () => {
  it('formats a date only by default', () => {
    render(<FormattedDateTime value="2026-12-15T14:00:00.000Z" locale="en" />);
    expect(screen.getByText('Dec 15, 2026')).toBeInTheDocument();
  });

  it('formats date and time when timeStyle is given, using the runtime time zone', () => {
    render(<FormattedDateTime value="2026-12-15T14:00:00.000Z" locale="en" timeStyle="short" />);
    const expected = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date('2026-12-15T14:00:00.000Z'));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('formats using the given locale', () => {
    render(<FormattedDateTime value="2026-12-15T14:00:00.000Z" locale="de" />);
    expect(screen.getByText('15.12.2026')).toBeInTheDocument();
  });
});
