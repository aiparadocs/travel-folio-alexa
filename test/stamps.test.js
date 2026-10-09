import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/stamps.js';
import { CITIES } from '../src/domain/catalog.js';

const { stampKey, stampName, glyphs } = globalThis.FolioStamps;

test('stamp names: known Kyoto places get their kanji name', () => {
  assert.equal(stampName('Kinkaku-ji'), '金閣寺');
  assert.equal(stampName('Kyoto Ramen Koji (Kyoto Station)'), '京都拉麺小路');
  assert.equal(stampName('Kitano Tenmangu'), '北野天満宮');
  assert.equal(stampName('Genko-an'), '源光庵');
});

test('stamp names: matching ignores case, spacing, hyphens, accents and notes in brackets', () => {
  assert.equal(stampName('kinkakuji'), '金閣寺');
  assert.equal(stampName('  KINKAKU JI '), '金閣寺');
  assert.equal(stampName('Genkō-an'), '源光庵');
  assert.equal(stampName('Inoda Coffee'), 'イノダコーヒ本店');
  assert.equal(stampKey('Sannenzaka & Ninenzaka lanes'), 'sannenzakaandninenzakalanes');
});

test('stamp names: unknown or empty names return null so the stamp uses English', () => {
  for (const name of ['Pike Place Market', 'Yuba soba lunch', '', null, undefined, '???']) assert.equal(stampName(name), null);
});

test('stamp names: every Kyoto sight, museum and market in the catalog has a stamp name', () => {
  const brands = new Set(['kyo-weekenders', 'kyo-kurasu', 'kyo-arabica-arashiyama']);
  for (const place of CITIES.kyoto.places) {
    if (!brands.has(place.id)) assert.ok(stampName(place.name), place.name);
  }
});

test('stamp names: the glyph list has each character once and covers the names', () => {
  assert.equal(new Set(glyphs).size, glyphs.length);
  for (const ch of '金閣寺北野天満宮ー') assert.ok(glyphs.includes(ch), ch);
});
