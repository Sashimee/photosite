import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FilterSheet } from './filter-sheet';

describe('FilterSheet', () => {
  it('applies the selected category, language and price range in cents', () => {
    const onApply = jest.fn();
    render(
      <FilterSheet
        visible
        initialValues={{}}
        onClose={jest.fn()}
        onApply={onApply}
        onClear={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('category-chip-wedding'));
    fireEvent.press(screen.getByTestId('language-chip-fr'));
    fireEvent.changeText(screen.getByTestId('filter-price-min'), '50');
    fireEvent.changeText(screen.getByTestId('filter-price-max'), '500');
    fireEvent.press(screen.getByTestId('filter-sheet-apply'));

    expect(onApply).toHaveBeenCalledWith({
      category: 'wedding',
      language: 'fr',
      priceMinCents: 5000,
      priceMaxCents: 50000,
    });
  });

  it('shows an inline error and does not apply when min price exceeds max price', () => {
    const onApply = jest.fn();
    render(
      <FilterSheet
        visible
        initialValues={{}}
        onClose={jest.fn()}
        onApply={onApply}
        onClear={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByTestId('filter-price-min'), '500');
    fireEvent.changeText(screen.getByTestId('filter-price-max'), '50');
    fireEvent.press(screen.getByTestId('filter-sheet-apply'));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('filter-sheet-error')).toBeTruthy();
  });

  it('resets the draft and calls onClear', () => {
    const onClear = jest.fn();
    render(
      <FilterSheet
        visible
        initialValues={{ category: 'wedding', priceMinCents: 1000 }}
        onClose={jest.fn()}
        onApply={jest.fn()}
        onClear={onClear}
      />,
    );

    fireEvent.press(screen.getByTestId('filter-sheet-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('calls onClose from the close button', () => {
    const onClose = jest.fn();
    render(
      <FilterSheet
        visible
        initialValues={{}}
        onClose={onClose}
        onApply={jest.fn()}
        onClear={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('filter-sheet-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
