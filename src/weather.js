import { addDays, dayStops, toMin } from './domain/planner.js';
import { getCity } from './domain/catalog.js';

// Weather comes from Open-Meteo (free, no API key): https://open-meteo.com/
// WEATHER_MODE=demo uses a fixed, clearly-labelled fixture so a demo recording
// is reproducible ("rain on day 1 from late morning through the afternoon").

export const RAIN_PROB_THRESHOLD = 50;

// Keep injected providers isolated, too: a test/demo provider's response must
// never be reused for a different live fetch implementation.
const caches = new WeakMap();

function demoHours(dayIndex) {
  return Array.from({ length: 24 }, (_, hour) => {
    let prob = 10;
    let mm = 0;
    if (dayIndex === 0) {
      prob = { 10: 65, 11: 75, 12: 80, 13: 70, 14: 85, 15: 80, 16: 65, 17: 40 }[hour] ?? 15;
      mm = prob >= 60 ? Math.round((prob - 50) / 10) / 2 : 0;
    }
    return { hour, precipitationProbability: prob, precipitationMm: mm };
  });
}

async function fetchLive(city, date, fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('Weather service is unavailable.');
  if (!caches.has(fetchImpl)) caches.set(fetchImpl, new Map());
  const cache = caches.get(fetchImpl);
  const key = `${city.id}:${date}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.value;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(city.lat));
  url.searchParams.set('longitude', String(city.lon));
  url.searchParams.set('hourly', 'precipitation_probability,precipitation');
  url.searchParams.set('timezone', city.timezone);
  url.searchParams.set('start_date', date);
  // Open-Meteo rain values describe the preceding hour. Include next midnight
  // so our local 23:00–24:00 interval can be assessed, then shift the labels.
  url.searchParams.set('end_date', addDays(date, 1));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const body = await res.json();
    const times = body?.hourly?.time || [];
    const probs = body?.hourly?.precipitation_probability || [];
    const mms = body?.hourly?.precipitation || [];
    if (!times.length) throw new Error('No hourly data for that date (forecasts cover about 16 days ahead).');
    const value = times.map((t, i) => ({
      date: Number(String(t).slice(11, 13)) === 0 ? addDays(String(t).slice(0, 10), -1) : String(t).slice(0, 10),
      hour: (Number(String(t).slice(11, 13)) + 23) % 24,
      precipitationProbability: typeof probs[i] === 'number' && Number.isFinite(probs[i]) && probs[i] >= 0 && probs[i] <= 100 ? probs[i] : null,
      precipitationMm: typeof mms[i] === 'number' && Number.isFinite(mms[i]) && mms[i] >= 0 ? mms[i] : null,
    })).filter((h) => h.date === date && Number.isInteger(h.hour) && h.hour >= 0 && h.hour <= 23)
      .map(({ date: _, ...hour }) => hour);
    if (!value.some((h) => h.precipitationProbability !== null || h.precipitationMm !== null)) throw new Error('Rain forecast data is missing for that date.');
    for (const [oldKey, entry] of cache) if (Date.now() - entry.at >= 30 * 60 * 1000) cache.delete(oldKey);
    cache.set(key, { at: Date.now(), value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {{source:'open-meteo'|'demo'|'unavailable', date:string, hours:Array, reason?:string}}
 */
export async function getDayForecast(trip, day, { mode = process.env.WEATHER_MODE || 'live', fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isInteger(day) || day < 1 || day > trip.days) throw new Error(`This trip has ${trip.days} day(s).`);
  const city = getCity(trip.city);
  const date = addDays(trip.startDate, day - 1);
  if (mode === 'demo') return { source: 'demo', date, hours: demoHours(day - 1) };
  try {
    return { source: 'open-meteo', date, hours: await fetchLive(city, date, fetchImpl) };
  } catch (err) {
    return { source: 'unavailable', date, hours: [], reason: err?.message || String(err) };
  }
}

/** Which weather-sensitive stops overlap rainy hours? */
export function assessRain(trip, day, forecast, threshold = RAIN_PROB_THRESHOLD) {
  const byHour = new Map(forecast.hours.map((h) => [h.hour, h]));
  const atRisk = [];
  const unknownStops = [];
  for (const s of dayStops(trip, day)) {
    if (s.done || s.exposure === 'indoor') continue;
    const start = toMin(s.time);
    const end = start + s.minutes;
    let maxProb = 0;
    let mm = 0;
    let complete = true;
    for (let h = Math.floor(start / 60); h * 60 < end; h++) {
      const w = byHour.get(h);
      if (!w || w.precipitationProbability == null || w.precipitationMm == null) complete = false;
      if (!w) continue;
      maxProb = Math.max(maxProb, w.precipitationProbability ?? 0);
      mm += w.precipitationMm ?? 0;
    }
    if (maxProb >= threshold || mm >= 1) {
      atRisk.push({ stopId: s.id, title: s.title, time: s.time, exposure: s.exposure, maxPrecipitationProbability: maxProb, locked: s.locked });
    }
    if (!complete) unknownStops.push({ stopId: s.id, title: s.title, time: s.time });
  }
  const rainyHours = forecast.hours.filter((h) => (h.precipitationProbability ?? 0) >= threshold || (h.precipitationMm ?? 0) >= 1).map((h) => h.hour);
  const window = rainyHours.length ? { from: `${String(Math.min(...rainyHours)).padStart(2, '0')}:00`, to: `${String(Math.max(...rainyHours) + 1).padStart(2, '0')}:00` } : null;
  return { atRisk, rainyWindow: window, unknownStops, assessmentComplete: forecast.source !== 'unavailable' && unknownStops.length === 0 };
}
