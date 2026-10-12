import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobileRoot = join(__dirname, '..', '..');
const LOCALES = ['en-US', 'fr-FR', 'de-DE', 'pt-PT', 'es-ES'];

interface AppleInfo {
  title: string;
  subtitle: string;
  description: string;
  keywords: string[];
  releaseNotes: string;
  privacyPolicyUrl: string;
  supportUrl: string;
  marketingUrl: string;
}

const config = JSON.parse(readFileSync(join(mobileRoot, 'store.config.json'), 'utf8')) as {
  configVersion: number;
  apple: { info: Record<string, AppleInfo> };
};

function infoFor(locale: string): AppleInfo {
  const info = config.apple.info[locale];
  if (!info) {
    throw new Error(`store.config.json has no apple.info.${locale}`);
  }
  return info;
}

function playText(locale: string, file: string): string {
  return readFileSync(join(mobileRoot, 'store', 'play', locale, file), 'utf8').trim();
}

describe('App Store listing (store.config.json)', () => {
  it('uses the EAS Metadata config version', () => {
    expect(config.configVersion).toBe(0);
  });

  it('holds no review contact, demo credentials or TODO placeholders', () => {
    expect(config.apple).not.toHaveProperty('review');
    expect(readFileSync(join(mobileRoot, 'store.config.json'), 'utf8')).not.toMatch(/TODO/);
  });

  it.each(LOCALES)('%s matches the Play full description', (locale) => {
    expect(infoFor(locale).description.trim()).toBe(playText(locale, 'full_description.txt'));
  });

  it('has exactly the supported locales', () => {
    expect(Object.keys(config.apple.info).sort()).toEqual([...LOCALES].sort());
  });

  it.each(LOCALES)('%s fits the App Store limits', (locale) => {
    const info = infoFor(locale);
    expect(info.title.length).toBeGreaterThan(0);
    expect(info.title.length).toBeLessThanOrEqual(30);
    expect(info.subtitle.length).toBeGreaterThan(0);
    expect(info.subtitle.length).toBeLessThanOrEqual(30);
    expect(info.keywords.length).toBeGreaterThan(0);
    expect(info.keywords.join(',').length).toBeLessThanOrEqual(100);
    expect(info.description.length).toBeGreaterThan(0);
    expect(info.description.length).toBeLessThanOrEqual(4000);
    expect(info.releaseNotes.length).toBeGreaterThan(0);
    expect(info.releaseNotes.length).toBeLessThanOrEqual(4000);
  });

  it.each(LOCALES)('%s links to https pages', (locale) => {
    const info = infoFor(locale);
    for (const url of [info.privacyPolicyUrl, info.supportUrl, info.marketingUrl]) {
      expect(url).toMatch(/^https:\/\/photoo\.lu\//);
    }
  });
});

describe('Play listing (store/play)', () => {
  it('has exactly the supported locales', () => {
    expect(readdirSync(join(mobileRoot, 'store', 'play')).sort()).toEqual([...LOCALES].sort());
  });

  it.each(LOCALES)('%s fits the Play limits', (locale) => {
    const title = playText(locale, 'title.txt');
    const short = playText(locale, 'short_description.txt');
    const full = playText(locale, 'full_description.txt');
    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(short.length).toBeGreaterThan(0);
    expect(short.length).toBeLessThanOrEqual(80);
    expect(full.length).toBeGreaterThan(0);
    expect(full.length).toBeLessThanOrEqual(4000);
  });
});
