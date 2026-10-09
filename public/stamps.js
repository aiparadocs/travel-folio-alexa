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

  const api = { stampKey, stampName, glyphs };
  root.FolioStamps = api;
})(typeof window !== 'undefined' ? window : globalThis);
