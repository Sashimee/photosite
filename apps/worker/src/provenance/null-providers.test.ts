import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createNoopC2paReader,
  createNullAiDetectionProvider,
  createNullReverseSearchProvider,
  selectAiDetectionProvider,
  selectC2paReader,
  selectReverseSearchProvider,
} from './null-providers.js';

function fakeLogger() {
  const warn = vi.fn();
  return { logger: { warn } as unknown as Logger, warn };
}

describe('null providers', () => {
  it('createNullAiDetectionProvider always returns a null result', async () => {
    const result = await createNullAiDetectionProvider().detect({ portfolioImageId: 'image-1' });
    expect(result).toEqual({ vendor: 'none', score: null, raw: null });
  });

  it('createNullReverseSearchProvider always returns no matches', async () => {
    const result = await createNullReverseSearchProvider().search({ portfolioImageId: 'image-1' });
    expect(result).toEqual({ vendor: 'none', matches: [] });
  });

  it('createNoopC2paReader always returns an unknown validity', async () => {
    const result = await createNoopC2paReader().read({ portfolioImageId: 'image-1' });
    expect(result).toEqual({ c2paValid: null });
  });
});

describe('provider selection', () => {
  it('selectAiDetectionProvider warns and returns the null provider when an API key is configured', async () => {
    const { logger, warn } = fakeLogger();
    const provider = selectAiDetectionProvider('some-key', logger);

    expect(warn).toHaveBeenCalledWith(
      'provenance: PROVENANCE_AI_DETECTION_API_KEY is set but no AI detection vendor is integrated yet',
    );
    await expect(provider.detect({ portfolioImageId: 'image-1' })).resolves.toEqual({
      vendor: 'none',
      score: null,
      raw: null,
    });
  });

  it('selectAiDetectionProvider stays quiet when no API key is configured', () => {
    const { logger, warn } = fakeLogger();
    selectAiDetectionProvider(undefined, logger);

    expect(warn).not.toHaveBeenCalled();
  });

  it('selectReverseSearchProvider warns and returns the null provider when an API key is configured', async () => {
    const { logger, warn } = fakeLogger();
    const provider = selectReverseSearchProvider('some-key', logger);

    expect(warn).toHaveBeenCalledWith(
      'provenance: PROVENANCE_REVERSE_SEARCH_API_KEY is set but no reverse search vendor is integrated yet',
    );
    await expect(provider.search({ portfolioImageId: 'image-1' })).resolves.toEqual({
      vendor: 'none',
      matches: [],
    });
  });

  it('selectReverseSearchProvider stays quiet when no API key is configured', () => {
    const { logger, warn } = fakeLogger();
    selectReverseSearchProvider(undefined, logger);

    expect(warn).not.toHaveBeenCalled();
  });

  it('selectC2paReader warns and returns the noop reader when enabled', async () => {
    const { logger, warn } = fakeLogger();
    const reader = selectC2paReader(true, logger);

    expect(warn).toHaveBeenCalledWith(
      'provenance: PROVENANCE_C2PA_ENABLED is set but no C2PA reader is integrated yet',
    );
    await expect(reader.read({ portfolioImageId: 'image-1' })).resolves.toEqual({
      c2paValid: null,
    });
  });

  it('selectC2paReader stays quiet when disabled', () => {
    const { logger, warn } = fakeLogger();
    selectC2paReader(false, logger);

    expect(warn).not.toHaveBeenCalled();
  });
});
