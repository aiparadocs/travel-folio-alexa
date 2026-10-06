import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTrip, dayStops, toMin, travelMinutes } from '../src/domain/planner.js';
import { computeChange } from '../src/domain/changes.js';
import { TripStore } from '../src/domain/store.js';

const makeTrip = (extra = {}) => createTrip({ city: 'kyoto', days: 2, interests: ['coffee', 'culture'], startDate: '2026-10-05', ...extra });

test('every supported city, duration and pace produces complete, non-overlapping days', () => {
  for (const city of ['kyoto', 'seattle']) for (const days of [1, 2, 3, 4]) for (const pace of ['relaxed', 'balanced', 'packed']) for (const interests of [[], ['coffee', 'culture'], ['nature', 'family']]) {
    const trip = makeTrip({ city, days, pace, interests });
    assert.equal(trip.days, days);
    assert.equal(new Set(trip.stops.map((s) => s.id)).size, trip.stops.length);
    const placeIds = trip.stops.map((s) => s.placeId).filter(Boolean);
    assert.equal(new Set(placeIds).size, placeIds.length);
    for (let day = 1; day <= days; day++) {
      const stops = dayStops(trip, day);
      assert.ok(stops.some((s) => s.placeId), `${city} ${days} ${pace}: day ${day} has activities`);
      for (let i = 0; i < stops.length; i++) {
        assert.ok(toMin(stops[i].time) + stops[i].minutes <= 1440);
        if (i) assert.ok(toMin(stops[i].time) >= toMin(stops[i - 1].time) + stops[i - 1].minutes + travelMinutes(stops[i - 1], stops[i]));
      }
    }
  }
});

test('four packed days distribute the finite activity catalog across every day', () => {
  const trip = makeTrip({ city: 'seattle', days: 4, pace: 'packed' });
  const counts = Array.from({ length: 4 }, (_, i) => dayStops(trip, i + 1).filter((s) => ['walk', 'indoor', 'shop'].includes(s.kind)).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test('preview leaves the original intact and preserves visited and locked stops', () => {
  const trip = makeTrip();
  const stops = dayStops(trip, 1);
  stops[0].done = true;
  stops.at(-1).locked = true;
  const original = structuredClone(trip);
  const { after } = computeChange(trip, { type: 'shift_day', day: 1, minutes: 30 });
  assert.deepEqual(trip, original);
  assert.deepEqual(after.stops.find((s) => s.id === stops[0].id), stops[0]);
  assert.deepEqual(after.stops.find((s) => s.id === stops.at(-1).id), stops.at(-1));
  for (const stop of [stops[0], stops.at(-1)]) {
    assert.throws(() => computeChange(trip, { type: 'remove_stop', stopId: stop.id }), /visited|locked/);
    assert.throws(() => computeChange(trip, { type: 'replace_stop', stopId: stop.id }), /visited|locked/);
  }
});

test('rain change needs evidence or a valid explicit window, and protects fixed stops', () => {
  const trip = makeTrip();
  const outdoors = dayStops(trip, 1).filter((s) => s.exposure !== 'indoor');
  outdoors[0].locked = true;
  assert.throws(() => computeChange(trip, { type: 'rain_swap', day: 1 }), /No affected/);
  assert.throws(() => computeChange(trip, { type: 'rain_swap', day: 1, from: '17:00', to: '13:00' }), /end after/);
  const { after, warnings } = computeChange(trip, { type: 'rain_swap', day: 1, from: '06:00', to: '22:00' });
  assert.deepEqual(after.stops.find((s) => s.id === outdoors[0].id), outdoors[0]);
  assert.ok(warnings.some((w) => /locked/.test(w)));
});

test('a long delay cannot silently clip activities to 23:59 or overlap a visited stop', () => {
  const trip = makeTrip({ days: 1, pace: 'packed' });
  trip.stops.forEach((s, i) => { s.time = `${String(16 + i).padStart(2, '0')}:00`; s.minutes = 90; });
  assert.throws(() => computeChange(trip, { type: 'shift_day', day: 1, minutes: 240 }), /midnight/);
  const visited = makeTrip();
  visited.stops[0].done = true;
  assert.throws(() => computeChange(visited, { type: 'shift_day', day: 1, minutes: -240 }), /visited or locked/);
});

test('proposal apply, stale rejection, expiry and undo preserve version safety', (t) => {
  const store = new TripStore();
  const before = store.setTrip(makeTrip());
  const change = { type: 'shift_day', day: 1, minutes: 30 };
  const { after, warnings } = computeChange(before, change);
  const p = store.createProposal(change, after, warnings);
  assert.deepEqual(store.getTrip(), before);
  p.after.stops[0].title = 'tampered copy';
  const applied = store.applyProposal(p.proposalId).trip;
  assert.equal(applied.version, 2);
  assert.equal(applied.stops[0].title, before.stops[0].title);
  assert.throws(() => store.applyProposal(p.proposalId), /not found|expired/);
  const restored = store.undo().trip;
  assert.deepEqual(restored.stops, before.stops);
  assert.equal(restored.version, 3);
  assert.throws(() => store.createProposal(change, after), /changed while preparing/);
  const pending = store.createProposal(change, computeChange(restored, change).after);
  store.markVisited(restored.stops[0].id);
  assert.throws(() => store.applyProposal(pending.proposalId), /not found|expired|stale/);
  const current = store.getTrip();
  const expiring = store.createProposal(change, computeChange(current, change).after);
  t.mock.method(Date, 'now', () => Date.parse(expiring.expiresAt));
  assert.throws(() => store.applyProposal(expiring.proposalId), /expired/);
});

test('saving failures are atomic, and a damaged saved trip cannot be overwritten', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-folio-domain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const store = new TripStore({ file });
  const before = store.setTrip(makeTrip());
  assert.deepEqual(new TripStore({ file }).getTrip(), before);
  const change = { type: 'shift_day', day: 1, minutes: 30 };
  const pending = store.createProposal(change, computeChange(before, change).after);
  fs.mkdirSync(`${file}.tmp`); // Deterministic write failure on Windows and Unix.
  assert.throws(() => store.applyProposal(pending.proposalId));
  assert.deepEqual(store.getTrip(), before);
  assert.equal(store.history.length, 0);
  assert.equal(store.getProposal(pending.proposalId).proposalId, pending.proposalId);
  assert.throws(() => store.markVisited(before.stops[0].id));
  assert.deepEqual(store.getTrip(), before);
  fs.writeFileSync(path.join(dir, 'broken.json'), '{truncated');
  const damaged = new TripStore({ file: path.join(dir, 'broken.json') });
  assert.throws(() => damaged.setTrip(makeTrip()), /saved trip could not be read/);
  assert.equal(fs.readFileSync(path.join(dir, 'broken.json'), 'utf8'), '{truncated');
});

test('marking a stop is undoable and repeated marking is idempotent', () => {
  const store = new TripStore();
  const before = store.setTrip(makeTrip());
  const updated = store.markVisited(before.stops[0].id);
  const repeated = store.markVisited(before.stops[0].id);
  assert.deepEqual(repeated, updated);
  assert.equal(store.undo().trip.stops[0].done, false);
});
