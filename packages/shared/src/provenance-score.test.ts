import { describe, expect, it } from 'vitest';
import {
  AI_SCORE_FAIL_THRESHOLD,
  AI_SCORE_REVIEW_THRESHOLD,
  computeProvenanceScore,
  FUTURE_CAPTURE_TOLERANCE_MS,
  OLDEST_PLAUSIBLE_CAPTURE,
  type ProvenanceSignals,
} from './provenance-score.js';

const noSignals: ProvenanceSignals = {
  aiScore: null,
  reverseMatches: null,
  c2paValid: null,
  hasExifCamera: null,
  exifCapturedAt: null,
};

describe('computeProvenanceScore', () => {
  it('returns review with a zero score when every signal is missing', () => {
    expect(computeProvenanceScore(noSignals)).toEqual({ score: 0, verdict: 'review' });
  });

  it('returns review for a single low aiScore: one signal is too thin to pass', () => {
    const result = computeProvenanceScore({ ...noSignals, aiScore: 0.1 });
    expect(result.verdict).toBe('review');
  });

  it('returns review for a single clean reverseMatches signal', () => {
    const result = computeProvenanceScore({ ...noSignals, reverseMatches: [] });
    expect(result.verdict).toBe('review');
  });

  it('returns review for a single hasExifCamera signal', () => {
    const result = computeProvenanceScore({ ...noSignals, hasExifCamera: true });
    expect(result.verdict).toBe('review');
  });

  it('returns review for a single valid exifCapturedAt signal', () => {
    const result = computeProvenanceScore({ ...noSignals, exifCapturedAt: new Date('2026-01-01') });
    expect(result.verdict).toBe('review');
  });

  it('passes on a valid C2PA signal alone', () => {
    const result = computeProvenanceScore({ ...noSignals, c2paValid: true });
    expect(result.verdict).toBe('pass');
  });

  it('reviews on an invalid C2PA signal alone', () => {
    const result = computeProvenanceScore({ ...noSignals, c2paValid: false });
    expect(result.verdict).toBe('review');
  });

  it('passes when two independent signals both come back clean', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      exifCapturedAt: new Date('2026-01-01'),
    });
    expect(result.verdict).toBe('pass');
  });

  it('fails on a high aiScore', () => {
    const result = computeProvenanceScore({ ...noSignals, aiScore: 0.95 });
    expect(result.verdict).toBe('fail');
    expect(result.score).toBeGreaterThanOrEqual(0.85);
  });

  it('reviews on a mid-range aiScore', () => {
    const result = computeProvenanceScore({ ...noSignals, aiScore: 0.5 });
    expect(result.verdict).toBe('review');
  });

  it('reviews on a single foreign-domain reverse match', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      reverseMatches: [{ domain: 'thief.example' }],
    });
    expect(result.verdict).toBe('review');
  });

  it('fails on multiple foreign-domain reverse matches', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      reverseMatches: [{ domain: 'thief.example' }, { domain: 'other-thief.example' }],
    });
    expect(result.verdict).toBe('fail');
  });

  it('does not count a match on the photographer own linked domain as foreign', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      reverseMatches: [{ domain: 'jane-doe-photography.com' }],
      ownDomains: ['jane-doe-photography.com'],
      aiScore: 0.05,
    });
    expect(result.verdict).toBe('pass');
  });

  it('reviews on a future exifCapturedAt', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      exifCapturedAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(result.verdict).toBe('review');
  });

  it('reviews on an implausibly old exifCapturedAt', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      exifCapturedAt: new Date('1970-01-01'),
    });
    expect(result.verdict).toBe('review');
  });

  it('reviews when signals are present but not enough of them are clean', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      hasExifCamera: false,
    });
    expect(result.verdict).toBe('review');
  });

  it('tolerates a small clock-skew capture time in the near future', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      exifCapturedAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(result.verdict).toBe('pass');
  });

  it('fails exactly at the AI_SCORE_FAIL_THRESHOLD', () => {
    const result = computeProvenanceScore({ ...noSignals, aiScore: AI_SCORE_FAIL_THRESHOLD });
    expect(result.verdict).toBe('fail');
  });

  it('reviews (not fails) just below the AI_SCORE_FAIL_THRESHOLD', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: AI_SCORE_FAIL_THRESHOLD - 0.01,
    });
    expect(result.verdict).toBe('review');
  });

  it('reviews exactly at the AI_SCORE_REVIEW_THRESHOLD', () => {
    const result = computeProvenanceScore({ ...noSignals, aiScore: AI_SCORE_REVIEW_THRESHOLD });
    expect(result.verdict).toBe('review');
  });

  it('treats a score just below the AI_SCORE_REVIEW_THRESHOLD as clean, passing alongside a second clean signal', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: AI_SCORE_REVIEW_THRESHOLD - 0.01,
      hasExifCamera: true,
    });
    expect(result.verdict).toBe('pass');
  });

  it('reviews when a dirty signal accompanies two clean ones: forceReview overrides the clean-signal count', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      hasExifCamera: true,
      c2paValid: false,
    });
    expect(result.verdict).toBe('review');
  });

  it('treats a capture exactly at OLDEST_PLAUSIBLE_CAPTURE as plausible, passing alongside a second clean signal', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      exifCapturedAt: OLDEST_PLAUSIBLE_CAPTURE,
    });
    expect(result.verdict).toBe('pass');
  });

  it('reviews a capture one millisecond before OLDEST_PLAUSIBLE_CAPTURE', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      exifCapturedAt: new Date(OLDEST_PLAUSIBLE_CAPTURE.getTime() - 1),
    });
    expect(result.verdict).toBe('review');
  });

  it('does not treat a capture exactly at the FUTURE_CAPTURE_TOLERANCE_MS boundary as future', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      exifCapturedAt: new Date(Date.now() + FUTURE_CAPTURE_TOLERANCE_MS),
    });
    expect(result.verdict).toBe('pass');
  });

  it('reviews a capture just past the FUTURE_CAPTURE_TOLERANCE_MS boundary', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      aiScore: 0.05,
      exifCapturedAt: new Date(Date.now() + FUTURE_CAPTURE_TOLERANCE_MS + 60_000),
    });
    expect(result.verdict).toBe('review');
  });

  it('reviews on clean EXIF camera and capture time alone: both come from the same forgeable blob', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      hasExifCamera: true,
      exifCapturedAt: new Date('2026-01-01'),
    });
    expect(result.verdict).toBe('review');
  });

  it('passes on clean EXIF (camera + capture time) alongside one other clean signal', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      hasExifCamera: true,
      exifCapturedAt: new Date('2026-01-01'),
      aiScore: 0.05,
    });
    expect(result.verdict).toBe('pass');
  });

  it('excludes missing signals from the score rather than counting them as clean', () => {
    const result = computeProvenanceScore({
      ...noSignals,
      reverseMatches: [],
      hasExifCamera: true,
    });
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('pass');
  });
});
