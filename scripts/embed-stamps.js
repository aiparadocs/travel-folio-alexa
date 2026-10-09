// Inline the shared ink-stamp script and SVG defs into the standalone phone journal,
// so saved copies keep their stamps and ticket logo without a server.
import fs from 'node:fs';
import '../public/stamps.js';

const target = new URL('../public/phone/index.html', import.meta.url);
const source = fs.readFileSync(new URL('../public/stamps.js', import.meta.url), 'utf8');
if (/<\/script|<!--/i.test(source)) throw new Error('stamps.js cannot be inlined: it contains </script or <!--');
const script = `<script id="folio-stamps">${source}</script>`;
const defs = `<!--folio-defs-->${globalThis.FolioStamps.defs}<!--/folio-defs-->`;
const scriptRe = /<script id="folio-stamps">[\s\S]*?<\/script>/;
const defsRe = /<!--folio-defs-->[\s\S]*?<!--\/folio-defs-->/;
const anchor = '<script>/* Journey Light: dependency-free data model.';

let html = fs.readFileSync(target, 'utf8');
html = scriptRe.test(html) ? html.replace(scriptRe, () => script) : html.replace(anchor, () => script + anchor);
html = defsRe.test(html) ? html.replace(defsRe, () => defs) : html.replace('<body data-mode="plan">', () => `<body data-mode="plan">\n${defs}`);
if (!scriptRe.test(html) || !defsRe.test(html)) throw new Error('Stamp insertion points missing');
fs.writeFileSync(target, html);
console.log('Embedded journal stamps and art defs.');
