// Downloads the small Google Fonts subsets Travel Folio ships (all SIL OFL 1.1).
// Re-run after changing the stamp names in public/stamps.js: node scripts/fetch-fonts.mjs
import fs from 'node:fs';
import '../public/stamps.js';

const { glyphs } = globalThis.FolioStamps;
const dir = new URL('../public/fonts/', import.meta.url);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const LATIN = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')
  + Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xA0 + i)).join('')
  + '‘’“”–—…•→←↑↓✓×☂';
const UI_KANJI = '旅済承認京都乗車券';
const FONTS = [
  { file: 'dela-gothic-one.woff2', family: 'Dela Gothic One', weight: 400, text: LATIN + UI_KANJI + glyphs, ofl: 'delagothicone' },
  { file: 'dotgothic16.woff2', family: 'DotGothic16', weight: 400, text: LATIN + UI_KANJI, ofl: 'dotgothic16' },
  { file: 'biz-udpgothic-400.woff2', family: 'BIZ UDPGothic', weight: 400, text: LATIN, ofl: 'bizudpgothic' },
  { file: 'biz-udpgothic-700.woff2', family: 'BIZ UDPGothic', weight: 700, text: LATIN, ofl: 'bizudpgothic' },
  { file: 'klee-one-600.woff2', family: 'Klee One', weight: 600, text: LATIN, ofl: 'kleeone' },
];
const BUDGET = 260 * 1024;

let total = 0;
for (const font of FONTS) {
  const family = encodeURIComponent(font.family).replace(/%20/g, '+');
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${font.weight}&text=${encodeURIComponent(font.text)}`, { headers: { 'User-Agent': UA } })).text();
  const src = css.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1];
  if (!src) throw new Error(`No woff2 for ${font.family} ${font.weight}: ${css.slice(0, 160)}`);
  const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
  fs.writeFileSync(new URL(font.file, dir), bytes);
  total += bytes.length;
  console.log(`${font.file.padEnd(26)} ${(bytes.length / 1024).toFixed(1)} KB`);
}
for (const ofl of new Set(FONTS.map((font) => font.ofl))) {
  const text = await (await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${ofl}/OFL.txt`)).text();
  if (!/SIL OPEN FONT LICENSE/i.test(text)) throw new Error(`Licence text not found for ${ofl}`);
  fs.writeFileSync(new URL(`${ofl}-OFL.txt`, dir), text);
}
console.log(`Total ${(total / 1024).toFixed(1)} KB (budget ${BUDGET / 1024} KB)`);
if (total > BUDGET) { console.error('Font budget exceeded: stop and ask before shipping.'); process.exitCode = 1; }
