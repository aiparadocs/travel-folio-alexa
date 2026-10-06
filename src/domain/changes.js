import { getCity, getPlace } from './catalog.js';
import { cloneTrip, dayStops, distanceKm, nextStopId, retimeDay, stopFromPlace, toMin } from './planner.js';

export const CHANGE_TYPES = Object.freeze(['rain_swap', 'shift_day', 'add_stop', 'remove_stop', 'replace_stop']);
export const ADDABLE_KINDS = Object.freeze(['coffee', 'food', 'indoor', 'shop', 'walk']);

function findStop(trip, stopId) {
  const s = trip.stops.find((x) => x.id === stopId);
  if (!s) throw new Error(`No stop with id "${stopId}". Call get_itinerary to see stop ids.`);
  return s;
}

function usedPlaceIds(trip) {
  return new Set(trip.stops.map((s) => s.placeId).filter(Boolean));
}

function indexInDay(trip, stop) {
  return dayStops(trip, stop.day).findIndex((s) => s.id === stop.id);
}

function pickNearest(trip, anchor, filter) {
  const city = getCity(trip.city);
  const used = usedPlaceIds(trip);
  let best = null;
  let bestScore = Infinity;
  for (const pl of city.places) {
    if (used.has(pl.id) || !filter(pl)) continue;
    const d = distanceKm(anchor, pl) ?? 5;
    const bonus = pl.tags.some((t) => trip.interests.includes(t)) ? 1.5 : 0; // ~1.5 km of preference
    const sc = d - bonus;
    if (sc < bestScore) { best = pl; bestScore = sc; }
  }
  return best;
}

function replaceWithPlace(stop, place) {
  Object.assign(stop, {
    placeId: place.id, title: place.name, kind: place.kind, exposure: place.exposure,
    minutes: place.minutes, lat: place.lat, lon: place.lon, note: place.note,
  });
}

function assertEditable(stop, verb) {
  if (stop.done) throw new Error(`"${stop.title}" is already marked visited, so I won't ${verb} it.`);
  if (stop.locked) throw new Error(`"${stop.title}" is locked (for example, a booking), so I won't ${verb} it.`);
}

function anchorForCoordinates(trip, stop) {
  if (stop?.lat != null) return stop;
  const withCoords = dayStops(trip, stop?.day ?? 1).filter((s) => s.lat != null);
  return withCoords[withCoords.length - 1] || getCity(trip.city);
}

/**
 * Apply a change to a COPY of the trip. Never mutates the input.
 * @param {object} trip
 * @param {object} change flattened change request (see CHANGE_TYPES)
 * @param {{atRiskStopIds?: string[]}} ctx facts from other tools (e.g. the weather check)
 */
export function computeChange(trip, change, ctx = {}) {
  if (!change || !CHANGE_TYPES.includes(change.type)) throw new Error(`Unknown change type. Use one of: ${CHANGE_TYPES.join(', ')}.`);
  const after = cloneTrip(trip);
  const warnings = [];
  const day = change.day ?? null;
  const requireDay = () => {
    if (!Number.isInteger(day) || day < 1 || day > trip.days) throw new Error(`"day" must be between 1 and ${trip.days}.`);
    return day;
  };

  switch (change.type) {
    case 'rain_swap': {
      const d = requireDay();
      let targets;
      if (Array.isArray(ctx.atRiskStopIds) && ctx.atRiskStopIds.length) {
        targets = dayStops(after, d).filter((s) => ctx.atRiskStopIds.includes(s.id));
      } else if (change.from && change.to) {
        const from = toMin(change.from);
        const to = toMin(change.to);
        if (from >= to) throw new Error('The rain window must end after it starts, within the same day.');
        targets = dayStops(after, d).filter((s) => s.exposure !== 'indoor' && toMin(s.time) < to && toMin(s.time) + s.minutes > from);
      } else {
        throw new Error('No affected outdoor stops were identified. Give a time window ("from"/"to") if you still want indoor options.');
      }
      targets = targets.filter((s) => {
        if (s.locked || s.done) { warnings.push(`Kept "${s.title}" because it is ${s.done ? 'visited' : 'locked'}.`); return false; }
        return s.exposure !== 'indoor';
      });
      if (!targets.length) throw new Error('Nothing to swap: the affected stops are already indoors, locked or visited.');
      for (const s of targets) {
        const alt = pickNearest(after, s, (pl) => pl.exposure === 'indoor' && pl.kind !== 'food' && pl.kind !== 'coffee');
        if (!alt) { warnings.push(`No unused indoor option near "${s.title}".`); continue; }
        replaceWithPlace(s, alt);
      }
      const firstIdx = Math.min(...targets.map((s) => indexInDay(after, s)));
      warnings.push(...retimeDay(after, d, Math.max(0, firstIdx)));
      break;
    }
    case 'shift_day': {
      const d = requireDay();
      const minutes = change.minutes;
      if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 240) throw new Error('"minutes" must be a non-zero whole number between -240 and 240.');
      const stops = dayStops(after, d);
      const firstIdx = stops.findIndex((s) => !s.done && !s.locked);
      if (firstIdx < 0) throw new Error(`Every stop on day ${d} is visited or locked.`);
      const first = stops[firstIdx];
      const t = toMin(first.time) + minutes;
      if (t < 6 * 60 || t > 20 * 60) throw new Error('That would start the day before 6 AM or after 8 PM.');
      if (firstIdx > 0) {
        const previous = stops[firstIdx - 1];
        if (t < toMin(previous.time) + previous.minutes) throw new Error('That would overlap a visited or locked stop. Choose a later time.');
      }
      first.time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      // When moving earlier, later stops should follow too; retime handles both directions.
      warnings.push(...retimeDay(after, d, firstIdx));
      break;
    }
    case 'add_stop': {
      const d = requireDay();
      const kind = change.kind || (change.placeId ? null : 'coffee');
      if (kind && !ADDABLE_KINDS.includes(kind)) throw new Error(`"kind" must be one of ${ADDABLE_KINDS.join(', ')}.`);
      const stops = dayStops(after, d);
      let anchor;
      if (change.afterStopId) {
        anchor = findStop(after, change.afterStopId);
        if (anchor.day !== d) throw new Error('afterStopId is on a different day.');
      } else {
        // default: after the last stop that starts by 2:30 PM, i.e. an afternoon break
        anchor = stops.filter((s) => toMin(s.time) <= 14 * 60 + 30).pop() || stops[0];
      }
      let place;
      if (change.placeId) {
        place = getPlace(after.city, change.placeId);
        if (!place) throw new Error(`Unknown placeId "${change.placeId}". Use list_places.`);
        if (usedPlaceIds(after).has(place.id)) throw new Error(`"${place.name}" is already in the trip.`);
      } else {
        place = pickNearest(after, anchorForCoordinates(after, anchor), (pl) => pl.kind === kind);
        if (!place) throw new Error(`I couldn't find another ${kind} spot that isn't already in the trip.`);
      }
      const stop = stopFromPlace(place, d, nextStopId(after));
      const globalIdx = anchor ? after.stops.findIndex((s) => s.id === anchor.id) + 1 : after.stops.length;
      stop.time = anchor ? anchor.time : '12:00';
      after.stops.splice(globalIdx, 0, stop);
      warnings.push(...retimeDay(after, d, anchor ? indexInDay(after, anchor) : 0));
      break;
    }
    case 'remove_stop': {
      const s = findStop(after, change.stopId);
      assertEditable(s, 'remove');
      const idx = indexInDay(after, s);
      after.stops = after.stops.filter((x) => x.id !== s.id);
      if (idx === 0) {
        const nextFirst = dayStops(after, s.day)[0];
        if (nextFirst && !nextFirst.locked && !nextFirst.done) nextFirst.time = s.time;
      }
      warnings.push(...retimeDay(after, s.day, Math.max(0, idx - 1)));
      break;
    }
    case 'replace_stop': {
      const s = findStop(after, change.stopId);
      assertEditable(s, 'replace');
      let place;
      if (change.placeId) {
        place = getPlace(after.city, change.placeId);
        if (!place) throw new Error(`Unknown placeId "${change.placeId}". Use list_places.`);
        if (usedPlaceIds(after).has(place.id)) throw new Error(`"${place.name}" is already in the trip.`);
      } else {
        const kind = change.kind || s.kind;
        place = pickNearest(after, anchorForCoordinates(after, s), (pl) => pl.kind === kind && pl.id !== s.placeId);
        if (!place) throw new Error(`No other ${kind} option is available.`);
      }
      replaceWithPlace(s, place);
      warnings.push(...retimeDay(after, s.day, indexInDay(after, s)));
      break;
    }
    default:
      throw new Error('Unsupported change.');
  }
  return { after, warnings: [...new Set(warnings)] };
}

/** Human-readable diff between two versions of a trip. */
export function diffTrips(before, after) {
  const b = new Map(before.stops.map((s) => [s.id, s]));
  const a = new Map(after.stops.map((s) => [s.id, s]));
  const changes = [];
  for (const s of after.stops) {
    const old = b.get(s.id);
    if (!old) changes.push({ op: 'added', day: s.day, stopId: s.id, after: { time: s.time, title: s.title, kind: s.kind } });
    else if (old.placeId !== s.placeId || old.title !== s.title) {
      changes.push({ op: 'replaced', day: s.day, stopId: s.id, before: { time: old.time, title: old.title, kind: old.kind }, after: { time: s.time, title: s.title, kind: s.kind } });
    } else if (old.time !== s.time) {
      changes.push({ op: 'moved', day: s.day, stopId: s.id, before: { time: old.time, title: old.title }, after: { time: s.time, title: s.title } });
    }
  }
  for (const s of before.stops) {
    if (!a.has(s.id)) changes.push({ op: 'removed', day: s.day, stopId: s.id, before: { time: s.time, title: s.title, kind: s.kind } });
  }
  const rank = { replaced: 0, added: 1, removed: 2, moved: 3 };
  changes.sort((x, y) => x.day - y.day || rank[x.op] - rank[y.op] || String((x.after || x.before).time).localeCompare(String((y.after || y.before).time)));
  return changes;
}

/** One or two short sentences that sound fine when spoken aloud. */
export function speakDiff(changes) {
  if (!changes.length) return 'That would not change anything.';
  const main = changes.filter((c) => c.op !== 'moved');
  const moved = changes.filter((c) => c.op === 'moved');
  const parts = main.slice(0, 3).map((c) => {
    if (c.op === 'replaced') return `swap ${c.before.title} for ${c.after.title} at ${c.after.time}`;
    if (c.op === 'added') return `add ${c.after.title} at ${c.after.time}`;
    return `drop ${c.before.title}`;
  });
  if (main.length > 3) parts.push(`${main.length - 3} more change${main.length - 3 > 1 ? 's' : ''}`);
  if (moved.length) {
    if (!main.length) {
      const deltas = moved.map((c) => toMin(c.after.time) - toMin(c.before.time));
      const same = deltas.every((d) => d === deltas[0]);
      const amt = Math.abs(deltas[0]);
      const amount = amt % 60 === 0 ? `${amt / 60} hour${amt === 60 ? '' : 's'}` : `${amt} minutes`;
      parts.push(same ? `move ${moved.length} stop${moved.length > 1 ? 's' : ''} ${deltas[0] > 0 ? 'later' : 'earlier'} by ${amount}` : `retime ${moved.length} stops`);
    } else {
      parts.push(`adjust the time of ${moved.length} later stop${moved.length > 1 ? 's' : ''}`);
    }
  }
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
