'use strict';

// Travel Folio ink stamps: one source for the browser pages, the MCP Apps card
// (inlined by src/mcp/apps.js) and Node (tests, scripts/fetch-fonts.mjs).
// Kanji names are decoration on stamps only; replies and data stay English.
(function (root) {
  const ENTRIES = [
    ['伏見稲荷大社', 'Fushimi Inari Taisha', 'Fushimi Inari'],
    ['清水寺', 'Kiyomizu-dera', 'Kiyomizu Temple'],
    ['三年坂・二年坂', 'Sannenzaka & Ninenzaka lanes', 'Sannenzaka', 'Ninenzaka'],
    ['祇園・花見小路', 'Gion & Hanamikoji Street', 'Gion', 'Hanamikoji'],
    ['哲学の道', "Philosopher's Path"],
    ['銀閣寺', 'Ginkaku-ji'],
    ['竹林の小径', 'Arashiyama Bamboo Grove'],
    ['天龍寺', 'Tenryu-ji Garden', 'Tenryu-ji'],
    ['金閣寺', 'Kinkaku-ji', 'Golden Pavilion'],
    ['二条城', 'Nijo Castle'],
    ['京都国立博物館', 'Kyoto National Museum'],
    ['京都鉄道博物館', 'Kyoto Railway Museum'],
    ['京都市京セラ美術館', 'Kyoto City KYOCERA Museum of Art'],
    ['京都国際マンガミュージアム', 'Kyoto International Manga Museum'],
    ['京都水族館', 'Kyoto Aquarium'],
    ['寺町・新京極', 'Teramachi & Shinkyogoku covered arcades', 'Teramachi', 'Shinkyogoku'],
    ['錦市場', 'Nishiki Market'],
    ['京都拉麺小路', 'Kyoto Ramen Koji (Kyoto Station)', 'Kyoto Ramen Koji'],
    ['先斗町', 'Pontocho Alley', 'Pontocho'],
    ['イノダコーヒ本店', 'Inoda Coffee (main shop)', 'Inoda Coffee'],
    ['スマート珈琲店', 'Smart Coffee'],
    ['北野天満宮', 'Kitano Tenmangu'],
    ['源光庵', 'Genko-an'],
    ['京都駅', 'Kyoto Station'],
  ];

  function stampKey(name) {
    return String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\(.*?\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
  }

  const NAMES = Object.create(null);
  for (const [ja, ...names] of ENTRIES) for (const name of names) NAMES[stampKey(name)] = ja;

  function stampName(name) {
    const key = stampKey(name);
    return key ? NAMES[key] ?? null : null;
  }

  const glyphs = [...new Set(ENTRIES.map(([ja]) => ja).join(''))].join('');

  const INK = { shu: '#E5452B', ame: '#2B63B5', ai: '#1C2F5C' };
  const DISPLAY = "'Folio Display', sans-serif";
  const DOT = "'Folio Dot', monospace";
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function nameLines(name) {
    const text = String(name ?? '').trim();
    if (text.length <= 12 || !text.includes(' ')) return [text];
    const words = text.split(/\s+/);
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      if (!best || Math.max(pair[0].length, pair[1].length) < Math.max(best[0].length, best[1].length)) best = pair;
    }
    return best;
  }

  // kind: 'ok' (change approved), 'done' (済, visited), 'rain', 'eki' (station-style place stamp).
  function stampSvg(kind, options = {}) {
    const color = INK[options.ink] || (kind === 'rain' ? INK.ame : INK.shu);
    const text = (y, size, family, value) => `<text x="60" y="${y}" text-anchor="middle" font-family="${family}" font-size="${size}" fill="${color}" stroke="none">${esc(value)}</text>`;
    const open = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g filter="url(#tf-ink)" fill="none" stroke="${color}">`;
    const close = '</g></svg>';
    if (kind === 'ok') return `${open}<circle cx="60" cy="60" r="52" stroke-width="5"/><circle cx="60" cy="60" r="43" stroke-width="1.6"/>${text(70, 32, DISPLAY, 'OK')}${text(92, 11, DOT, options.sub || '承認')}${close}`;
    if (kind === 'done') return `${open}<circle cx="60" cy="60" r="50" stroke-width="5"/>${text(72, 36, DISPLAY, '済')}${text(96, 12, DOT, options.sub || '')}${close}`;
    if (kind === 'rain') return `${open}<circle cx="60" cy="60" r="50" stroke-width="5"/><path d="M34 58a26 26 0 0 1 52 0zM60 58v18a6 6 0 0 1-12 0" stroke-width="5" stroke-linejoin="round"/>${text(100, 13, DOT, options.sub || 'RAIN')}${close}`;
    const lines = nameLines(options.name);
    const longest = Math.max(1, ...lines.map((line) => line.length));
    const ja = /[^\x00-\x7F]/.test(lines.join(''));
    const size = lines.length > 1 ? (longest <= 10 ? 13 : 11)
      : ja ? (longest <= 3 ? 24 : longest <= 5 ? 18 : longest <= 7 ? 14 : 11)
        : (longest <= 8 ? 16 : longest <= 12 ? 13 : 11);
    const clip = (line) => (line.length > 22 ? `${line.slice(0, 21)}…` : line);
    const names = lines.map((line, i) => text(lines.length > 1 ? 58 + i * (size + 3) : 66, size, DISPLAY, clip(line))).join('');
    return `${open}<circle cx="60" cy="60" r="54" stroke-width="4"/><circle cx="60" cy="60" r="46" stroke-width="1.5"/>${text(34, 10, DOT, options.top || 'TRAVEL FOLIO')}<path d="M36 42h48M36 82h48" stroke-width="1.5"/>${names}${text(96, 10, DOT, options.sub || '')}${close}`;
  }

  // Inline once per page (SVG filters and <use> only work within one document).
  const defs = '<svg class="art-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>'
    + '<filter id="tf-ink" x="-10%" y="-10%" width="120%" height="120%">'
    + '<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="4" result="warp"/>'
    + '<feDisplacementMap in="SourceGraphic" in2="warp" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="warped"/>'
    + '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="9" result="speck"/>'
    + '<feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3.4 0 0 0 3.1" result="mask"/>'
    + '<feComposite in="warped" in2="mask" operator="in"/></filter>'
    + '<mask id="tf-logo-cut"><rect width="48" height="48" fill="#fff"/><circle cx="2" cy="24" r="4.6" fill="#000"/><circle cx="46" cy="24" r="4.6" fill="#000"/><circle cx="35.5" cy="15" r="2.3" fill="#000"/>'
    + `<text x="20.5" y="31.5" text-anchor="middle" font-family="${DISPLAY}" font-size="17" fill="#000">旅</text>`
    + '<path d="M31 21v14" stroke="#000" stroke-width="1.1" stroke-dasharray="1.6 1.6"/></mask>'
    + '<symbol id="tf-logo" viewBox="0 0 48 48"><g filter="url(#tf-ink)"><rect x="2" y="9" width="44" height="30" rx="4" fill="#E5452B" mask="url(#tf-logo-cut)"/></g></symbol>'
    + '</defs></svg>';

  const api = { stampKey, stampName, glyphs, stampSvg, defs };
  root.FolioStamps = api;
})(typeof window !== 'undefined' ? window : globalThis);
