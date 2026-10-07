import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

async function renderFilters(props: Record<string, unknown> = {}) {
  const { FinanceFilters } = await import('./finance-filters');
  render(await FinanceFilters(props));
  return screen.getByRole('search');
}

describe('FinanceFilters', () => {
  it('is a GET form with no hidden cursor field, so a filter change restarts paging', async () => {
    const form = await renderFilters({ status: ['released'], dispute: 'open' });

    expect(form).toHaveAttribute('method', 'get');
    expect(form).not.toHaveAttribute('action', expect.stringContaining('cursor'));
    expect(form.querySelector('[name="cursor"]')).toBeNull();
    expect(form.querySelector('input[type="hidden"]')).toBeNull();
  });

  it('renders every booking status as a checkbox named status, none checked by default', async () => {
    const form = await renderFilters();

    const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="status"]'));
    expect(boxes.length).toBeGreaterThan(1);
    expect(boxes.every((box) => box.type === 'checkbox' && !box.checked)).toBe(true);
    expect(new Set(boxes.map((box) => box.value)).size).toBe(boxes.length);
  });

  it('pre-fills the current filters', async () => {
    const form = await renderFilters({
      status: ['released', 'disputed'],
      createdFrom: '2026-09-01',
      createdTo: '2026-10-01',
      dispute: 'none',
    });

    const checked = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="status"]:checked'),
    ).map((box) => box.value);
    expect(checked.sort()).toEqual(['disputed', 'released']);
    expect(form.querySelector<HTMLInputElement>('[name="createdFrom"]')).toHaveValue('2026-09-01');
    expect(form.querySelector<HTMLInputElement>('[name="createdTo"]')).toHaveValue('2026-10-01');
    expect(form.querySelector<HTMLSelectElement>('[name="dispute"]')).toHaveValue('none');
  });

  it('offers any, open and none plus an all option for the dispute filter', async () => {
    const form = await renderFilters();

    const select = form.querySelector<HTMLSelectElement>('[name="dispute"]');
    expect(Array.from(select?.options ?? []).map((option) => option.value)).toEqual([
      '',
      'any',
      'open',
      'none',
    ]);
    expect(select).toHaveValue('');
  });

  it('uses date inputs and a submit button, and clear links to /finance without params', async () => {
    const form = await renderFilters({ dispute: 'open' });

    expect(form.querySelector('[name="createdFrom"]')).toHaveAttribute('type', 'date');
    expect(form.querySelector('[name="createdTo"]')).toHaveAttribute('type', 'date');
    expect(form.querySelector('button[type="submit"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: /clear/i })).toHaveAttribute('href', '/finance');
  });
});
