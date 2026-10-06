// Keep the journal's kraft paper texture available in saved, offline HTML.
import fs from 'node:fs';

const texture = new URL('../public/textures/kraft-paper.webp', import.meta.url);
const target = new URL('../public/phone/index.html', import.meta.url);
const bytes = fs.readFileSync(texture);
const html = fs.readFileSync(target, 'utf8');
const declaration = /^:root \{ --kraft-grain:url\([^\r\n]*$/gm;

if ([...html.matchAll(declaration)].length !== 1) {
  throw new Error('Expected exactly one kraft paper CSS declaration.');
}

const next = html.replace(declaration, () =>
  `:root { --kraft-grain:url("data:image/webp;base64,${bytes.toString('base64')}"); }`);
fs.writeFileSync(target, next);
console.log('Embedded journal kraft paper texture.');
