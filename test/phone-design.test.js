import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../public/stamps.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url));
const html = read('../public/phone/index.html').toString('utf8');

test('phone journal embeds the kippu fonts and their licences, not the old handwriting fonts', () => {
  const block = html.match(/<style id="folio-fonts">([\s\S]*?)<\/style>/)[1];
  for (const family of ['Folio Display', 'Folio Dot', 'Folio UD', 'Folio Pen']) assert.match(block, new RegExp(`font-family: '${family}'`), family);
  assert.doesNotMatch(block, /font-family: '(Caveat|Nunito)'/);
  assert.doesNotMatch(block, /url\('\.\//, 'every font is embedded as a data URL');
  for (const notice of ['Dela Gothic Project Authors', 'DotGothic16 Project Authors', 'BIZ UDGothic Project Authors', 'Klee Project Authors']) assert.ok(block.includes(notice), notice);
  assert.match(block, /--font-title: var\(--font-display\)/, 'older journal rules map onto the new faces');
});

test('phone journal paper is the approved light kraft texture', () => {
  const light = read('../public/textures/kraft-paper-light.webp').toString('base64');
  assert.ok(html.includes(`--kraft-grain:url("data:image/webp;base64,${light}")`));
});
