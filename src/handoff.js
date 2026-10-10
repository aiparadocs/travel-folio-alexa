import QRCode from 'qrcode';
import { dayStops } from './domain/planner.js';

// Encodes a trip into the "#trip=" link format understood by the Travel Folio
// phone journal (public/phone/index.html). This mirrors that app's
// JourneyTransfer.pack/compress so the phone can import the plan with no server.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const PHONE_KINDS = ['train', 'coffee', 'walk', 'food', 'stay', 'shop', 'indoor', 'other'];

export function compress(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 60000) throw new Error('This plan is too large for a link.');
  const dict = new Map();
  let next = 256;
  let w = '';
  let out = '';
  const emit = (n) => { out += ALPHABET[n >> 6] + ALPHABET[n & 63]; };
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    const wc = w + c;
    if (w === '' || dict.has(wc)) w = wc;
    else {
      emit(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
      if (next < 4096) dict.set(wc, next++);
      w = c;
    }
  }
  if (w) emit(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
  return out;
}

export function decompress(code) {
  if (typeof code !== 'string' || !code.length || code.length > 12000 || code.length % 2 || /[^A-Za-z0-9_-]/.test(code)) throw new Error('This plan link is invalid or too large.');
  const dict = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
  let next = 256;
  let w = '';
  let out = '';
  for (let i = 0; i < code.length; i += 2) {
    const n = ALPHABET.indexOf(code[i]) * 64 + ALPHABET.indexOf(code[i + 1]);
    let entry = dict[n];
    if (entry === undefined) {
      if (n === next && w) entry = w + w[0];
      else throw new Error('damaged');
    }
    if (out.length + entry.length > 60000) throw new Error('This plan link expands beyond the allowed size.');
    out += entry;
    if (w && next < 4096) dict[next++] = w + entry[0];
    w = entry;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(out, (c) => c.charCodeAt(0)));
}

export function packForPhone(trip) {
  const stops = [];
  for (let d = 1; d <= trip.days; d++) {
    for (const s of dayStops(trip, d)) {
      const kind = PHONE_KINDS.includes(s.kind) ? s.kind : 'other';
      stops.push([s.day, s.time, s.title.slice(0, 80), kind, (s.note || '').slice(0, 300), s.locked ? 1 : 0]);
    }
  }
  return [2, trip.title.slice(0, 60), trip.cityName.slice(0, 60), trip.startDate || '', trip.days, 0, stops];
}

export function phoneLink(trip, baseUrl, { homeToken } = {}) {
  const base = new URL('/phone/', baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('The phone link must use an HTTP or HTTPS address.');
  // Optional pairing token: lets this phone share memories back to the same home later.
  if (homeToken) base.searchParams.set('home', homeToken);
  return `${base.href}#trip=${compress(JSON.stringify(packForPhone(trip)))}`;
}

export async function handoff(trip, baseUrl, { shorten, ...linkOptions } = {}) {
  const url = phoneLink(trip, baseUrl, linkOptions);
  // A whole plan in the QR needs version 25+, too dense for a phone camera to read
  // off a screen. With a resolver the QR carries a short link (version 3) instead;
  // "Open journal" and "Copy link" keep the full, portable link.
  const qrUrl = shorten ? new URL(`/t/${shorten(url)}`, baseUrl).href : url;
  const options = { type: 'svg', margin: 4, color: { dark: '#14202b', light: '#ffffff' } };
  // Full four-day plans can exceed the M-level QR capacity. Keep every note
  // in the portable link and use L correction for these larger codes.
  let qrSvg;
  try {
    qrSvg = await QRCode.toString(qrUrl, { ...options, errorCorrectionLevel: 'M' });
  } catch {
    qrSvg = await QRCode.toString(qrUrl, { ...options, errorCorrectionLevel: 'L' });
  }
  const host = new URL(baseUrl).hostname;
  const reachable = !(host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '[::]' || host === '[::1]' || /^127\./.test(host));
  return { url, qrUrl, qrSvg, reachableFromPhone: reachable, length: url.length };
}
