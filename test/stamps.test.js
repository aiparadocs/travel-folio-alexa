import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('stampSvg: OK, done, rain and station stamps use the shared ink filter', () => {
  const { stampSvg } = globalThis.FolioStamps;
  for (const kind of ['ok', 'done', 'rain', 'eki']) {
    const svg = stampSvg(kind, { name: 'Kinkaku-ji' });
    assert.match(svg, /^<svg viewBox="0 0 120 120"/, kind);
    assert.match(svg, /filter="url\(#tf-ink\)"/, kind);
  }
  assert.match(stampSvg('ok'), />OK</);
  assert.match(stampSvg('ok', { sub: 'APPLIED' }), />APPLIED</);
  assert.match(stampSvg('done'), />済</);
  assert.match(stampSvg('rain'), /#2B63B5/);
});

test('stampSvg: station stamp shows the kanji name, place and day, and escapes text', () => {
  const { stampSvg, stampName } = globalThis.FolioStamps;
  const svg = stampSvg('eki', { name: stampName('Kinkaku-ji'), top: 'KYOTO', sub: 'DAY 2' });
  assert.match(svg, />金閣寺</);
  assert.match(svg, />KYOTO</);
  assert.match(svg, />DAY 2</);
  const hostile = stampSvg('eki', { name: '<img/onerror=1>' });
  assert.doesNotMatch(hostile, /<img/);
  assert.match(hostile, /&lt;img\/onerror=1&gt;/);
  assert.match(stampSvg('eki', { name: '<b>&"q"' }), /&lt;b&gt;&amp;&quot;q&quot;/);
});

test('stampSvg: long English names wrap to two lines and very long ones are clipped', () => {
  const { stampSvg } = globalThis.FolioStamps;
  const two = stampSvg('eki', { name: 'Seattle Central Library' });
  assert.equal((two.match(/font-family="'Folio Display'/g) || []).length, 2);
  const long = stampSvg('eki', { name: 'Supercalifragilisticexpialidocious' });
  assert.match(long, /…</);
});

test('defs: the ink filter and ticket logo are defined once for every page', () => {
  const { defs } = globalThis.FolioStamps;
  assert.match(defs, /<filter id="tf-ink"/);
  assert.match(defs, /<symbol id="tf-logo"/);
  assert.match(defs, /<mask id="tf-logo-cut">/);
});

test('defs: the home page inlines the exact shared art defs', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(globalThis.FolioStamps.defs), 'public/index.html must contain FolioStamps.defs verbatim');
  assert.match(html, /<script src="\/stamps\.js" defer><\/script>/);
  assert.doesNotMatch(html, /planner-spark|postcard|class="journey"/, 'the old sparkle, postcard and Plan→Go→Keep row are gone');
});
