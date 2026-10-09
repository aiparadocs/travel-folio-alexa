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

test('phone journal inlines the shared stamp script and the art defs', () => {
  const stamps = read('../public/stamps.js').toString('utf8');
  assert.ok(html.includes(`<script id="folio-stamps">${stamps}</script>`), 'stamps.js is inlined verbatim');
  assert.ok(html.includes(`<!--folio-defs-->${globalThis.FolioStamps.defs}<!--/folio-defs-->`), 'art defs are inlined verbatim');
  assert.ok(html.indexOf('id="folio-stamps"') < html.indexOf('/* Vanilla UI.'), 'stamps load before the UI script');
});

test('phone journal uses the ticket logo and renders 済 and station stamps', () => {
  assert.match(html, /<span class="brand-icon"><svg class="brand-mark" aria-hidden="true"><use href="#tf-logo"\/><\/svg><\/span>/);
  assert.doesNotMatch(html, /data-icon="book"><\/span><span>Travel Folio/);
  assert.match(html, /<meta name="theme-color" content="#1C2F5C">/);
  assert.match(html, /class="visit-stamp/);
  assert.match(html, /stationStamp\(s,'memory-stamp'\)/);
  assert.match(html, /stationStamp\(s,'folio-memory-stamp'\)/);
  assert.doesNotMatch(html, /A little room for possibility\./);
});

test('phone journal waits for the faces its print sheets use before measuring pages', () => {
  const wait = html.match(/const paperFontsReady=[\s\S]*?:Promise\.resolve\(\);/)[0];
  for (const face of ['Folio UD', 'Folio Display', 'Folio Dot', 'Folio Pen']) assert.ok(wait.includes(face), face);
  assert.doesNotMatch(wait, /Nunito|Caveat/);
});
