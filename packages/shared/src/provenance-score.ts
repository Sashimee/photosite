import type { ProvenanceVerdict } from './enums.js';

export interface ProvenanceReverseMatchSignal {
  domain: string;
}

export interface ProvenanceSignals {
  aiScore: number | null;
  reverseMatches: readonly ProvenanceReverseMatchSignal[] | null;
  ownDomains?: readonly string[];
  c2paValid: boolean | null;
  hasExifCamera: boolean | null;
  exifCapturedAt: Date | null;
}

export interface ProvenanceScoreResult {
  score: number;
  verdict: ProvenanceVerdict;
}

// A vendor this confident an image is AI-generated is treated as conclusive;
// routing it to a human would just repeat the same call the vendor already
// made with high confidence.
export const AI_SCORE_FAIL_THRESHOLD = 0.85;

// Below outright-fail confidence but too suspicious to wave through
// automatically, so it drops to a human reviewer instead of passing.
export const AI_SCORE_REVIEW_THRESHOLD = 0.4;

// Two or more reposts on domains the photographer hasn't linked is stronger
// evidence of theft than a single stray crawler copy, so it fails outright
// rather than waiting on a human.
export const FOREIGN_MATCH_FAIL_THRESHOLD = 2;

// A single signal, however clean, can be wrong on its own; automatic passing
// needs at least two independent signals to agree, unless one of them is the
// cryptographic C2PA signal (see below).
export const MIN_SIGNAL_COUNT_FOR_AUTO_PASS = 2;

// Clock drift and timezone bugs can put a genuine capture time a few hours
// into the future without the image being tampered with; only a capture
// date further out than this tolerance is treated as a sanity failure.
export const FUTURE_CAPTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

// A capture date this old predates commodity digital cameras, so it more
// likely reflects a bad clock or rewritten metadata than a genuine capture.
export const OLDEST_PLAUSIBLE_CAPTURE = new Date('1990-01-01T00:00:00.000Z');

export function computeProvenanceScore(signals: ProvenanceSignals): ProvenanceScoreResult {
  const ownDomains = new Set((signals.ownDomains ?? []).map((domain) => domain.toLowerCase()));

  let presentSignals = 0;
  let riskSum = 0;
  let riskWeight = 0;
  let cleanSignals = 0;
  let c2paPass = false;
  let forceFail = false;
  let forceReview = false;

  if (signals.aiScore !== null) {
    presentSignals += 1;
    riskSum += signals.aiScore;
    riskWeight += 1;
    if (signals.aiScore >= AI_SCORE_FAIL_THRESHOLD) {
      forceFail = true;
    } else if (signals.aiScore >= AI_SCORE_REVIEW_THRESHOLD) {
      forceReview = true;
    } else {
      cleanSignals += 1;
    }
  }

  if (signals.reverseMatches !== null) {
    presentSignals += 1;
    const foreignMatchCount = signals.reverseMatches.filter(
      (match) => !ownDomains.has(match.domain.toLowerCase()),
    ).length;
    riskSum += Math.min(1, foreignMatchCount / FOREIGN_MATCH_FAIL_THRESHOLD);
    riskWeight += 1;
    if (foreignMatchCount >= FOREIGN_MATCH_FAIL_THRESHOLD) {
      forceFail = true;
    } else if (foreignMatchCount > 0) {
      forceReview = true;
    } else {
      cleanSignals += 1;
    }
  }

  if (signals.c2paValid !== null) {
    presentSignals += 1;
    riskSum += signals.c2paValid ? 0 : 1;
    riskWeight += 1;
    if (signals.c2paValid) {
      cleanSignals += 1;
      c2paPass = true;
    } else {
      forceReview = true;
    }
  }

  if (signals.hasExifCamera !== null) {
    presentSignals += 1;
    riskSum += signals.hasExifCamera ? 0 : 0.2;
    riskWeight += 1;
    if (signals.hasExifCamera) {
      cleanSignals += 1;
    }
  }

  if (signals.exifCapturedAt !== null) {
    presentSignals += 1;
    riskWeight += 1;
    const isFuture = signals.exifCapturedAt.getTime() - Date.now() > FUTURE_CAPTURE_TOLERANCE_MS;
    const isTooOld = signals.exifCapturedAt < OLDEST_PLAUSIBLE_CAPTURE;
    if (isFuture || isTooOld) {
      riskSum += 1;
      forceReview = true;
    } else {
      cleanSignals += 1;
    }
  }

  const score = riskWeight === 0 ? 0 : riskSum / riskWeight;

  if (forceFail) {
    return { score, verdict: 'fail' };
  }

  const tooThin = presentSignals < MIN_SIGNAL_COUNT_FOR_AUTO_PASS && !c2paPass;
  if (forceReview || tooThin) {
    return { score, verdict: 'review' };
  }

  if (c2paPass || cleanSignals >= MIN_SIGNAL_COUNT_FOR_AUTO_PASS) {
    return { score, verdict: 'pass' };
  }

  return { score, verdict: 'review' };
}
