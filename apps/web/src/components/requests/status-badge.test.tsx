import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isTerminalQuoteStatus, isTerminalRequestStatus, StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders the given label', () => {
    render(<StatusBadge label="Open" />);
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('applies the muted style when told to', () => {
    render(<StatusBadge label="Cancelled" muted />);
    expect(screen.getByText('Cancelled')).toHaveClass('text-muted-foreground');
  });
});

describe('isTerminalRequestStatus', () => {
  it('flags closed and cancelled requests as terminal', () => {
    expect(isTerminalRequestStatus('closed')).toBe(true);
    expect(isTerminalRequestStatus('cancelled')).toBe(true);
  });

  it('does not flag open, quoted or booked requests as terminal', () => {
    expect(isTerminalRequestStatus('open')).toBe(false);
    expect(isTerminalRequestStatus('quoted')).toBe(false);
    expect(isTerminalRequestStatus('booked')).toBe(false);
  });
});

describe('isTerminalQuoteStatus', () => {
  it('flags declined, expired and withdrawn quotes as terminal', () => {
    expect(isTerminalQuoteStatus('declined')).toBe(true);
    expect(isTerminalQuoteStatus('expired')).toBe(true);
    expect(isTerminalQuoteStatus('withdrawn')).toBe(true);
  });

  it('does not flag draft, sent or accepted quotes as terminal', () => {
    expect(isTerminalQuoteStatus('draft')).toBe(false);
    expect(isTerminalQuoteStatus('sent')).toBe(false);
    expect(isTerminalQuoteStatus('accepted')).toBe(false);
  });
});
