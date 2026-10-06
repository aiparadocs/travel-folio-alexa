import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// MCP Apps (io.modelcontextprotocol/ui, spec 2026-01-26): one self-contained
// HTML view that Alexa+-style hosts render for trip tool results.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.join(HERE, '..', '..', 'public', 'fonts');

export const MCP_APP_MIME = 'text/html;profile=mcp-app';
export const UI_EXTENSION = 'io.modelcontextprotocol/ui';

function fontFace(family, file, weight) {
  const data = fs.readFileSync(path.join(FONTS, file)).toString('base64');
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weight};font-display:block}`;
}

// Fonts are inlined: the view declares no external origins in its CSP.
export const TRIP_CARD_HTML = fs.readFileSync(path.join(HERE, 'trip-card.html'), 'utf8')
  .replace('/*__FONTS__*/', `${fontFace('Caveat', 'caveat-latin-variable.woff2', '400 700')}${fontFace('Nunito', 'nunito-latin-variable.woff2', '200 1000')}`);

// Versioned by content hash, as the Alexa+ rendering guide recommends.
export const TRIP_CARD_URI = `ui://travel-folio/trip-card-${createHash('sha256').update(TRIP_CARD_HTML).digest('hex').slice(0, 10)}.html`;

export const TRIP_CARD_META = Object.freeze({ ui: Object.freeze({ csp: Object.freeze({ connectDomains: [], resourceDomains: [] }), prefersBorder: false }) });

/** Tool `_meta` linking a result to the trip card. */
export const withTripCard = Object.freeze({ ui: Object.freeze({ resourceUri: TRIP_CARD_URI }) });
