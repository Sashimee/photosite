import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { roles: ['photographer'] } }),
}));

jest.mock('../../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn(), PATCH: jest.fn(), DELETE: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../../src/lib/i18n';
import { api } from '../../../src/lib/api';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);
const mockedPatch = jest.mocked(api.PATCH);
const mockedDelete = jest.mocked(api.DELETE);

const PROFILE = { id: 'p1', countryCode: 'LU' };
const COUNTRIES = [{ code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'en' }];

function makeProduct(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    profileId: 'p1',
    title: { en: `Product ${id}` },
    description: { en: 'Full day' },
    category: 'wedding',
    durationMinutes: 480,
    deliverables: { photos: 200, onlineGallery: true },
    basePrice: { amountCents: 150000, currency: 'EUR' },
    isActive: true,
    order: 0,
    tiers: [
      {
        id: `${id}-t1`,
        usage: 'personal',
        price: { amountCents: 150050, currency: 'EUR' },
        description: 'Personal use',
        licenceTextVersion: 'v1',
      },
      {
        id: `${id}-t2`,
        usage: 'commercial',
        price: { amountCents: 300000, currency: 'EUR' },
        description: 'Commercial use',
        licenceTextVersion: 'v1',
      },
    ],
    ...overrides,
  };
}

function ok(data: unknown, status = 200) {
  return Promise.resolve({ data, error: undefined, response: new Response(null, { status }) });
}

function failed(status: number, error: unknown = {}) {
  return Promise.resolve({ data: undefined, error, response: new Response(null, { status }) });
}

interface World {
  list?: Promise<unknown> | (() => Promise<unknown>);
  profile?: Promise<unknown>;
  product?: Promise<unknown>;
}

function mockWorld(world: World) {
  mockedGet.mockImplementation(((path: string) => {
    if (path === '/v1/me/products') {
      const { list } = world;
      return typeof list === 'function' ? list() : (list ?? ok([]));
    }
    if (path === '/v1/me/products/{productId}') {
      return world.product ?? failed(404);
    }
    if (path === '/v1/me/photographer-profile') {
      return world.profile ?? ok(PROFILE);
    }
    if (path === '/v1/countries') {
      return ok(COUNTRIES);
    }
    return failed(500);
  }) as never);
}

let current: ReturnType<typeof renderRouter>;

function open(url: string) {
  current = renderRouter('./app', { initialUrl: url });
}

function fillValidProduct() {
  fireEvent.changeText(screen.getByTestId('product-title-en'), 'Wedding day');
  fireEvent.press(screen.getByTestId('product-category-wedding'));
  fireEvent.changeText(screen.getByTestId('product-duration'), '480');
  fireEvent.changeText(screen.getByTestId('product-base-price'), '1500');
  fireEvent.press(screen.getByTestId('product-tier-0-usage-personal'));
  fireEvent.changeText(screen.getByTestId('product-tier-0-price'), '1500.5');
  fireEvent.changeText(screen.getByTestId('product-tier-0-description'), 'Personal use');
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('studio products list', () => {
  it('lists products with their lowest tier price and flags inactive ones', async () => {
    mockWorld({
      list: ok([makeProduct('b', { order: 1, isActive: false }), makeProduct('a')]),
    });
    open('/studio/products');

    await screen.findByTestId('product-row-a');
    expect(screen.getByText('Product a')).toBeTruthy();
    expect(screen.getAllByText('From €1,500.50')).toHaveLength(2);
    expect(screen.getByTestId('product-inactive-b')).toBeTruthy();
    expect(screen.queryByTestId('product-inactive-a')).toBeNull();
  });

  it('shows the empty state with an add button', async () => {
    mockWorld({ list: ok([]) });
    open('/studio/products');

    await screen.findByTestId('products-empty');
    expect(screen.getByTestId('products-new')).toBeTruthy();
  });

  it('shows a loading state, then a session message on 401', async () => {
    mockWorld({ list: failed(401) });
    open('/studio/products');

    expect(screen.getByTestId('products-loading')).toBeTruthy();
    await screen.findByTestId('products-unauthorized');
  });

  it('shows an error with retry that reloads the list', async () => {
    let calls = 0;
    mockWorld({ list: () => (calls++ === 0 ? failed(500) : ok([makeProduct('a')])) });
    open('/studio/products');

    fireEvent.press(await screen.findByTestId('products-retry'));

    await screen.findByTestId('product-row-a');
  });

  it('points a user without a profile to profile creation', async () => {
    mockWorld({ list: failed(404) });
    open('/studio/products');

    fireEvent.press(await screen.findByTestId('products-create-profile'));

    await waitFor(() => {
      expect(current.getPathname()).toBe('/studio/profile');
    });
  });

  it('is reachable from the Studio hub', async () => {
    mockWorld({ list: ok([]) });
    open('/studio');

    fireEvent.press(await screen.findByTestId('studio-entry-products'));

    await screen.findByTestId('products-empty');
    expect(current.getPathname()).toBe('/studio/products');
  });
});

describe('studio product create', () => {
  it('posts integer cents and tiers, then returns to a single list', async () => {
    mockWorld({ list: ok([]) });
    mockedPost.mockResolvedValueOnce(ok(makeProduct('new'), 201));
    open('/studio/products');

    fireEvent.press(await screen.findByTestId('products-new'));
    await screen.findByTestId('product-form');
    fillValidProduct();
    fireEvent.press(screen.getByTestId('product-submit'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
    expect(mockedPost).toHaveBeenCalledWith('/v1/me/products', {
      body: {
        title: { en: 'Wedding day' },
        description: null,
        category: 'wedding',
        durationMinutes: 480,
        deliverables: {},
        basePrice: { amountCents: 150000, currency: 'EUR' },
        isActive: true,
        tiers: [
          {
            usage: 'personal',
            price: { amountCents: 150050, currency: 'EUR' },
            description: 'Personal use',
            licenceTextVersion: 'v1',
          },
        ],
      },
    });
    await screen.findByTestId('products-list');
    expect(current.getPathname()).toBe('/studio/products');
    expect(screen.queryByTestId('product-form')).toBeNull();
  });

  it('refetches the list after saving so the new product appears', async () => {
    const created = makeProduct('new');
    let saved = false;
    mockWorld({ list: () => ok(saved ? [created] : []) });
    mockedPost.mockImplementationOnce((() => {
      saved = true;
      return ok(created, 201);
    }) as never);
    open('/studio/products');

    fireEvent.press(await screen.findByTestId('products-new'));
    await screen.findByTestId('product-form');
    fillValidProduct();
    fireEvent.press(screen.getByTestId('product-submit'));

    await screen.findByTestId('product-row-new');
  });

  it('rejects duplicate tier usages without calling the API', async () => {
    mockWorld({});
    open('/studio/products/new');

    await screen.findByTestId('product-form');
    fillValidProduct();
    fireEvent.press(screen.getByTestId('product-add-tier'));
    fireEvent.press(screen.getByTestId('product-tier-1-usage-personal'));
    fireEvent.changeText(screen.getByTestId('product-tier-1-price'), '20');
    fireEvent.changeText(screen.getByTestId('product-tier-1-description'), 'Again');
    fireEvent.press(screen.getByTestId('product-submit'));

    await screen.findByText('Each usage can only be used once.');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('rejects a price with more than two decimals without calling the API', async () => {
    mockWorld({});
    open('/studio/products/new');

    await screen.findByTestId('product-form');
    fillValidProduct();
    fireEvent.changeText(screen.getByTestId('product-tier-0-price'), '19.999');
    fireEvent.press(screen.getByTestId('product-submit'));

    await screen.findByText('Enter an amount with at most two decimals, like 150 or 149.99.');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('requires a title in at least one language', async () => {
    mockWorld({});
    open('/studio/products/new');

    await screen.findByTestId('product-form');
    fillValidProduct();
    fireEvent.changeText(screen.getByTestId('product-title-en'), '  ');
    fireEvent.press(screen.getByTestId('product-submit'));

    await screen.findByTestId('product-title-error');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('caps tiers at one per licence usage', async () => {
    mockWorld({});
    open('/studio/products/new');

    await screen.findByTestId('product-form');
    for (let i = 0; i < 3; i += 1) {
      fireEvent.press(screen.getByTestId('product-add-tier'));
    }

    expect(screen.getByTestId('product-tier-3')).toBeTruthy();
    expect(screen.getByTestId('product-add-tier')).toBeDisabled();
  });

  it('keeps at least one tier', async () => {
    mockWorld({});
    open('/studio/products/new');

    await screen.findByTestId('product-form');

    expect(screen.getByTestId('product-tier-0-remove')).toBeDisabled();
  });

  it('shows server validation errors on the field they name', async () => {
    mockWorld({});
    mockedPost.mockResolvedValueOnce(
      failed(400, {
        code: 'VALIDATION_ERROR',
        details: [{ path: 'tiers.0.price.amountCents', message: 'too high' }],
      }),
    );
    open('/studio/products/new');

    await screen.findByTestId('product-form');
    fillValidProduct();
    fireEvent.press(screen.getByTestId('product-submit'));

    await screen.findByText("This value isn't valid.");
    expect(screen.getByTestId('product-form-error')).toBeTruthy();
    expect(screen.getByTestId('product-form')).toBeTruthy();
  });

  it('shows a generic server error and stays on the form', async () => {
    mockWorld({});
    mockedPost.mockResolvedValueOnce(failed(500, { code: 'INTERNAL' }));
    open('/studio/products/new');

    await screen.findByTestId('product-form');
    fillValidProduct();
    fireEvent.press(screen.getByTestId('product-submit'));

    await screen.findByText('Something went wrong. Try again.');
    expect(current.getPathname()).toBe('/studio/products/new');
  });

  it('sends only one request when submit is pressed twice', async () => {
    mockWorld({});
    let release: (value: unknown) => void = () => undefined;
    mockedPost.mockImplementationOnce(
      (() => new Promise((resolve) => (release = resolve))) as never,
    );
    open('/studio/products/new');

    await screen.findByTestId('product-form');
    fillValidProduct();
    fireEvent.press(screen.getByTestId('product-submit'));
    fireEvent.press(screen.getByTestId('product-submit'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('product-submit')).toBeDisabled();
    release(await ok(makeProduct('new'), 201));
    await waitFor(() => {
      expect(current.getPathname()).toBe('/studio/products');
    });
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('asks for a profile first when there is none', async () => {
    mockWorld({ profile: failed(404) });
    open('/studio/products/new');

    await screen.findByTestId('product-needs-profile');
  });

  it('shows a session message on 401', async () => {
    mockWorld({ profile: failed(401) });
    open('/studio/products/new');

    await screen.findByTestId('product-unauthorized');
  });
});

describe('studio product edit', () => {
  it('prefills every field from the product, converting cents to amounts', async () => {
    mockWorld({ product: ok(makeProduct('a')) });
    open('/studio/products/a');

    expect((await screen.findByTestId('product-title-en')).props.value).toBe('Product a');
    expect(screen.getByTestId('product-base-price').props.value).toBe('1500');
    expect(screen.getByTestId('product-tier-0-price').props.value).toBe('1500.50');
    expect(screen.getByTestId('product-tier-1-price').props.value).toBe('3000');
    expect(screen.getByTestId('product-tier-1-usage-commercial')).toBeSelected();
    expect(screen.getByTestId('product-category-wedding')).toBeSelected();
    expect(screen.getByTestId('product-deliverable-0-key').props.value).toBe('photos');
    expect(screen.getByTestId('product-duration').props.value).toBe('480');
  });

  it('patches the product and returns to the list', async () => {
    mockWorld({ product: ok(makeProduct('a')), list: ok([makeProduct('a')]) });
    mockedPatch.mockResolvedValueOnce(ok(makeProduct('a')) as never);
    open('/studio/products/a');

    fireEvent.changeText(await screen.findByTestId('product-tier-0-price'), '99.9');
    fireEvent.press(screen.getByTestId('product-submit'));

    await waitFor(() => {
      expect(mockedPatch).toHaveBeenCalledTimes(1);
    });
    const [path, options] = mockedPatch.mock.calls[0] as unknown as [
      string,
      { params: unknown; body: { tiers: { price: unknown }[] } },
    ];
    expect(path).toBe('/v1/me/products/{productId}');
    expect(options.params).toEqual({ path: { productId: 'a' } });
    expect(options.body.tiers[0]?.price).toEqual({ amountCents: 9990, currency: 'EUR' });
    await screen.findByTestId('products-list');
    expect(current.getPathname()).toBe('/studio/products');
  });

  it('shows not found for an unknown product', async () => {
    mockWorld({ product: failed(404) });
    open('/studio/products/missing');

    await screen.findByTestId('product-not-found');
  });

  it('deletes only after confirmation and returns to the list', async () => {
    mockWorld({ product: ok(makeProduct('a')), list: ok([]) });
    mockedDelete.mockResolvedValueOnce(ok(undefined, 204));
    open('/studio/products/a');

    fireEvent.press(await screen.findByTestId('product-delete'));
    expect(mockedDelete).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByTestId('product-delete-confirm'));

    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('/v1/me/products/{productId}', {
        params: { path: { productId: 'a' } },
      });
    });
    await screen.findByTestId('products-empty');
    expect(current.getPathname()).toBe('/studio/products');
  });

  it('can back out of a delete', async () => {
    mockWorld({ product: ok(makeProduct('a')) });
    open('/studio/products/a');

    fireEvent.press(await screen.findByTestId('product-delete'));
    fireEvent.press(await screen.findByTestId('product-delete-dismiss'));

    expect(mockedDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId('product-delete')).toBeTruthy();
  });

  it('keeps the product and shows an error when delete fails', async () => {
    mockWorld({ product: ok(makeProduct('a')) });
    mockedDelete.mockResolvedValueOnce(failed(403, { code: 'FORBIDDEN' }));
    open('/studio/products/a');

    fireEvent.press(await screen.findByTestId('product-delete'));
    fireEvent.press(await screen.findByTestId('product-delete-confirm'));

    await screen.findByTestId('product-delete-error');
    expect(current.getPathname()).toBe('/studio/products/a');
  });
});
