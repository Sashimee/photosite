import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/photographers',
}));

import { LocaleSwitcher } from './locale-switcher';

const localeNames = {
  en: 'English',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  es: 'Spanish',
};

describe('LocaleSwitcher', () => {
  it('shows the current locale name on the trigger', () => {
    render(<LocaleSwitcher currentLocale="en" label="Change language" localeNames={localeNames} />);

    expect(screen.getByRole('button', { name: 'Change language' })).toHaveTextContent('English');
  });

  it('lists every supported locale and preserves the current path when switching', async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher currentLocale="en" label="Change language" localeNames={localeNames} />);

    await user.click(screen.getByRole('button', { name: 'Change language' }));

    const frenchLink = await screen.findByRole('menuitem', { name: 'French' });
    expect(frenchLink).toHaveAttribute('href', '/fr/photographers');
  });
});
