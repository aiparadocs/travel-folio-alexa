// Keep the standalone journal's fonts and redistribution notices self-contained.
import fs from 'node:fs';
const fontDir = new URL('../public/fonts/', import.meta.url);
const target = new URL('../public/phone/index.html', import.meta.url);
let css = fs.readFileSync(new URL('fonts.css', fontDir), 'utf8');
css = css.replace(/url\('\.\/([^']+\.woff2)'\)/g, (_, name) => {
  const bytes = fs.readFileSync(new URL(name, fontDir));
  return `url('data:font/woff2;base64,${bytes.toString('base64')}')`;
});
const licenses = ['delagothicone-OFL.txt', 'dotgothic16-OFL.txt', 'bizudpgothic-OFL.txt', 'kleeone-OFL.txt'].map(name =>
  fs.readFileSync(new URL(name, fontDir), 'utf8')).join('\n\n');
const block = `<style id="folio-fonts">\n/*\n${licenses}\n*/\n${css}\n</style>`;
const html = fs.readFileSync(target, 'utf8');
const next = html.includes('<style id="folio-fonts">')
  ? html.replace(/<style id="folio-fonts">[\s\S]*?<\/style>/, () => block)
  : html.replace('<style>:root', () => block + '\n<style>:root');
if (next === html && !html.includes('<style id="folio-fonts">')) throw new Error('Font insertion point missing');
fs.writeFileSync(target, next);
console.log('Embedded journal fonts and licenses.');
