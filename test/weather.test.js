import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRain, getDayForecast } from '../src/weather.js';
import { createTrip } from '../src/domain/planner.js';

const trip = () => ({ ...createTrip({ city: 'kyoto', days: 1, startDate: '2026-10-05' }), stops: [
  { id: 'out', day: 1, title: 'Garden', time: '13:00', minutes: 60, exposure: 'outdoor', done: false, locked: false },
  { id: 'in', day: 1, title: 'Museum', time: '15:00', minutes: 60, exposure: 'indoor', done: false },
] });

test('demo forecasts remain labelled and only affect overlapping outdoor stops', async () => {
  const plan = trip();
  const forecast = await getDayForecast(plan, 1, { mode: 'demo' });
  assert.equal(forecast.source, 'demo');
  const result = assessRain(plan, 1, forecast);
  assert.deepEqual(result.atRisk.map((s) => s.stopId), ['out']);
  assert.deepEqual(result.rainyWindow, { from: '10:00', to: '17:00' });
  assert.equal(result.assessmentComplete, true);
  plan.stops[0].done = true;
  assert.deepEqual(assessRain(plan, 1, forecast).atRisk, []);
});

test('Open-Meteo preceding-hour data maps to the correct local visit and is cached per provider', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url.searchParams.get('timezone'), 'Asia/Tokyo');
    assert.equal(url.searchParams.get('start_date'), '2026-10-05');
    assert.equal(url.searchParams.get('end_date'), '2026-10-06');
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ hourly: {
      time: ['2026-10-05T14:00', '2026-10-06T00:00'],
      precipitation_probability: [80, 0], precipitation: [2, 0],
    } }) };
  };
  const forecast = await getDayForecast(trip(), 1, { mode: 'live', fetchImpl });
  assert.equal(forecast.source, 'open-meteo');
  assert.deepEqual(forecast.hours.map((h) => h.hour), [13, 23]);
  assert.deepEqual(assessRain(trip(), 1, forecast).atRisk.map((s) => s.stopId), ['out']);
  await getDayForecast(trip(), 1, { mode: 'live', fetchImpl });
  assert.equal(calls, 1);
  const other = await getDayForecast(trip(), 1, { mode: 'live', fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(other.source, 'unavailable');
});

test('network errors and all-null or wrong-day data are unavailable, never sunny', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => ({ hourly: { time: ['2026-10-05T14:00'], precipitation_probability: [null], precipitation: [null] } }) }),
    async () => ({ ok: true, json: async () => ({ hourly: { time: ['2026-10-09T14:00'], precipitation_probability: [0], precipitation: [0] } }) }),
  ]) {
    const forecast = await getDayForecast(trip(), 1, { mode: 'live', fetchImpl });
    assert.equal(forecast.source, 'unavailable');
    assert.equal(assessRain(trip(), 1, forecast).assessmentComplete, false);
  }
});

test('partially missing data preserves an unknown assessment for exposed stops', () => {
  for (const hours of [[], [{ hour: 13, precipitationProbability: null, precipitationMm: 0 }]]) {
    const result = assessRain(trip(), 1, { source: 'open-meteo', hours });
    assert.equal(result.assessmentComplete, false);
    assert.deepEqual(result.unknownStops.map((s) => s.stopId), ['out']);
  }
});

test('forecast rejects a day outside the current trip', async () => {
  await assert.rejects(getDayForecast(trip(), 2, { mode: 'demo' }), /1 day/);
});
