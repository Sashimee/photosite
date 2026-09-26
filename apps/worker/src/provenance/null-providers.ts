import type { Logger } from 'nestjs-pino';
import type {
  AiDetectionProvider,
  AiDetectionResult,
  C2paReader,
  C2paResult,
  ReverseSearchProvider,
  ReverseSearchResult,
} from './types.js';

const NULL_AI_DETECTION_RESULT: AiDetectionResult = { vendor: 'none', score: null, raw: null };
const NULL_REVERSE_SEARCH_RESULT: ReverseSearchResult = { vendor: 'none', matches: [] };
const NULL_C2PA_RESULT: C2paResult = { c2paValid: null };

export function createNullAiDetectionProvider(): AiDetectionProvider {
  return {
    detect() {
      return Promise.resolve(NULL_AI_DETECTION_RESULT);
    },
  };
}

export function createNullReverseSearchProvider(): ReverseSearchProvider {
  return {
    search() {
      return Promise.resolve(NULL_REVERSE_SEARCH_RESULT);
    },
  };
}

export function createNoopC2paReader(): C2paReader {
  return {
    read() {
      return Promise.resolve(NULL_C2PA_RESULT);
    },
  };
}

// No AI-detection or reverse-search vendor is integrated yet
// (docs/steps/1A.10-provenance.md); a configured key doesn't do anything
// until a real adapter exists, so it only gets a startup warning instead of
// silently being ignored.
export function selectAiDetectionProvider(
  apiKey: string | undefined,
  logger: Logger,
): AiDetectionProvider {
  if (apiKey) {
    logger.warn(
      'provenance: PROVENANCE_AI_DETECTION_API_KEY is set but no AI detection vendor is integrated yet',
    );
  }
  return createNullAiDetectionProvider();
}

export function selectReverseSearchProvider(
  apiKey: string | undefined,
  logger: Logger,
): ReverseSearchProvider {
  if (apiKey) {
    logger.warn(
      'provenance: PROVENANCE_REVERSE_SEARCH_API_KEY is set but no reverse search vendor is integrated yet',
    );
  }
  return createNullReverseSearchProvider();
}

export function selectC2paReader(enabled: boolean, logger: Logger): C2paReader {
  if (enabled) {
    logger.warn('provenance: PROVENANCE_C2PA_ENABLED is set but no C2PA reader is integrated yet');
  }
  return createNoopC2paReader();
}
