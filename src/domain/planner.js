import { getCity, INTERESTS, PACES } from './catalog.js';
import { randomUUID } from 'node:crypto';

export const MAX_DAYS = 4;

const PACE = Object.freeze({
  relaxed: { start: '10:00', activities: 2 },
  balanced: { start: '09:30', activities: 3 },
  packed: { start: '09:00', activities: 4 },
});

// ---------- time helpers ----------
export function toMin(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) throw new Error(`Invalid time "${hhmm}". Use HH:MM.`);
  const [h, m] = hhmm.split(':').map(Number);
  if (h > 23 || m > 59) throw new Error(`Invalid time "${hhmm}".`);
  return h * 60 + m;
}

export function toClock(min) {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date in the city's own time zone (so "tomorrow" means the city's tomorrow). */
export function todayIn(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ---------- geo ----------
export function distanceKm(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough door-to-door estimate: 10 min overhead + ~18 km/h average, rounded to 5 min. */
export function travelMinutes(a, b) {
  const km = distanceKm(a, b);
  if (km == null) return 20;
  const raw = 10 + (km / 18) * 60;
  return Math.min(75, Math.round(raw / 5) * 5);
}

// ---------- stops ----------
export function stopFromPlace(place, day, id) {
  return {
    id,
    day,
    time: '00:00',
    placeId: place.id,
    title: place.name,
    kind: place.kind,
    exposure: place.exposure,
    minutes: place.minutes,
    lat: place.lat,
    lon: place.lon,
    note: place.note,
    locked: false,
    done: false,
  };
}

export function hotelStop(day, id) {
  return {
    id, day, time: '00:00', placeId: null, title: 'Back to your hotel', kind: 'stay', exposure: 'indoor',
    minutes: 30, lat: null, lon: null, note: 'Rest up. Check your check-in time.', locked: false, done: false,
  };
}

export function dayStops(trip, day) {
  return trip.stops.filter((s) => s.day === day);
}

export function nextStopId(trip) {
  trip.seq = (trip.seq || 0) + 1;
  return `s${trip.seq}`;
}

/**
 * Recompute times for one day from position `fromIndex`, keeping the order of
 * trip.stops as the source of truth. Locked/visited stops keep their time; if
 * the schedule would run into them, a warning is returned instead of silently
 * moving a booked time.
 */
export function retimeDay(trip, day, fromIndex = 0) {
  const stops = dayStops(trip, day);
  const warnings = [];
  for (let i = Math.max(1, fromIndex + 1); i < stops.length; i++) {
    const prev = stops[i - 1];
    const cur = stops[i];
    const earliest = toMin(prev.time) + prev.minutes + travelMinutes(prev, cur);
    if (cur.locked || cur.done) {
      if (earliest > toMin(cur.time)) {
        warnings.push(`"${cur.title}" is fixed at ${cur.time}, but the plan would reach it around ${toClock(earliest)}.`);
      }
      continue;
    }
    if (earliest + cur.minutes > 24 * 60) throw new Error(`Day ${day} would run past midnight. Remove a stop or start earlier.`);
    if (earliest > 23 * 60) warnings.push(`Day ${day} now runs past 11 PM.`);
    cur.time = toClock(earliest);
  }
  return warnings;
}

// ---------- trip creation ----------
function score(place, interests) {
  const hits = place.tags.filter((t) => interests.includes(t)).length;
  return 1 + hits * 2 + (interests.length === 0 && place.tags.includes('culture') ? 0.5 : 0);
}

function nearestUnused(places, used, anchor, filter) {
  let best = null;
  let bestD = Infinity;
  for (const pl of places) {
    if (used.has(pl.id) || !filter(pl)) continue;
    const d = distanceKm(anchor, pl) ?? 0;
    if (d < bestD) { best = pl; bestD = d; }
  }
  return best;
}

export function normalizeTripRequest(input = {}) {
  const city = getCity(input.city);
  const days = Number.isInteger(input.days) ? input.days : 2;
  if (days < 1 || days > MAX_DAYS) throw new Error(`Trips can be 1 to ${MAX_DAYS} days.`);
  const pace = PACES.includes(input.pace) ? input.pace : 'balanced';
  const interests = [...new Set((input.interests || []).map((x) => String(x).toLowerCase()).filter((x) => INTERESTS.includes(x)))];
  let startDate = input.startDate;
  if (startDate != null && startDate !== '' && !isIsoDate(startDate)) throw new Error('startDate must be YYYY-MM-DD.');
  if (!startDate) startDate = addDays(todayIn(city.timezone, input.now), 1);
  return { city, days, pace, interests, startDate };
}

export function createTrip(input = {}) {
  const { city, days, pace, interests, startDate } = normalizeTripRequest(input);
  const cfg = PACE[pace];
  const trip = {
    id: `trip-${city.id}-${randomUUID()}`,
    city: city.id,
    cityName: city.name,
    timezone: city.timezone,
    title: `${days} ${days === 1 ? 'day' : 'days'} in ${city.name}`,
    startDate,
    days,
    pace,
    interests,
    version: 1,
    seq: 0,
    stops: [],
  };

  const used = new Set();
  const activities = city.places.filter((pl) => ['walk', 'indoor', 'shop'].includes(pl.kind));
  const ranked = activities.slice().sort((a, b) => score(b, interests) - score(a, interests));
  const wantsCoffee = interests.includes('coffee');

  for (let day = 1; day <= days; day++) {
    // 1) choose a cluster of activities: best remaining seed, then best score-minus-distance neighbours
    const remaining = ranked.filter((pl) => !used.has(pl.id));
    // Spread a finite catalog across every requested day, instead of filling
    // early days at the expense of an almost empty final day.
    const activityCount = Math.min(cfg.activities, Math.ceil(remaining.length / (days - day + 1)));
    const seed = remaining[0];
    if (!seed) break;
    const picks = [seed];
    used.add(seed.id);
    while (picks.length < activityCount) {
      const last = picks[picks.length - 1];
      let best = null;
      let bestVal = -Infinity;
      for (const pl of ranked) {
        if (used.has(pl.id)) continue;
        const val = score(pl, interests) - (distanceKm(last, pl) ?? 0) * 0.6;
        if (val > bestVal) { best = pl; bestVal = val; }
      }
      if (!best) break;
      picks.push(best);
      used.add(best.id);
    }

    // 2) sequence: morning coffee (coffee lovers, day 2+), activities with lunch in the middle, afternoon coffee
    const seq = [];
    if (wantsCoffee && day > 1) {
      const c = nearestUnused(city.places, used, picks[0], (pl) => pl.kind === 'coffee' && pl.exposure === 'indoor');
      if (c) { used.add(c.id); seq.push(c); }
    }
    const lunchAfter = Math.ceil(picks.length / 2);
    picks.forEach((pl, i) => {
      seq.push(pl);
      if (i + 1 === lunchAfter) {
        const lunch = nearestUnused(city.places, used, pl, (x) => x.kind === 'food');
        if (lunch) { used.add(lunch.id); seq.push(lunch); }
      }
    });
    if (wantsCoffee || pace === 'relaxed') {
      const anchor = seq[seq.length - 1];
      const c = nearestUnused(city.places, used, anchor, (pl) => pl.kind === 'coffee');
      if (c) {
        used.add(c.id);
        // place the coffee break before the final activity when possible, for a mid-afternoon rest
        seq.splice(Math.max(1, seq.length - 1), 0, c);
      }
    }

    for (const pl of seq) trip.stops.push(stopFromPlace(pl, day, nextStopId(trip)));
    if (day < days) trip.stops.push(hotelStop(day, nextStopId(trip)));

    const first = dayStops(trip, day)[0];
    if (first) first.time = cfg.start;
    retimeDay(trip, day, 0);
  }
  return trip;
}

export function cloneTrip(trip) {
  return JSON.parse(JSON.stringify(trip));
}

/** A compact, speech/LLM-friendly view of the itinerary. */
export function summarizeTrip(trip, day = null) {
  const days = [];
  for (let d = 1; d <= trip.days; d++) {
    if (day != null && d !== day) continue;
    days.push({
      day: d,
      date: addDays(trip.startDate, d - 1),
      stops: dayStops(trip, d).map((s) => ({
        stopId: s.id, time: s.time, title: s.title, kind: s.kind, exposure: s.exposure,
        minutes: s.minutes, locked: s.locked, done: s.done, placeId: s.placeId,
      })),
    });
  }
  return { tripId: trip.id, title: trip.title, city: trip.city, startDate: trip.startDate, version: trip.version, pace: trip.pace, interests: trip.interests, days };
}
