import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createTravelFolioServer } from '../src/mcp/server.js';
import { TripStore } from '../src/domain/store.js';
import { createTrip } from '../src/domain/planner.js';

async function session(t, { capabilities = {}, onElicit, ...deps } = {}) {
  const store = deps.store || new TripStore();
  const server = createTravelFolioServer({ store, publicBaseUrl: () => 'http://127.0.0.1:3000', weatherMode: 'demo', ...deps });
  const client = new Client({ name: 'tests', version: '1.0.0' }, { capabilities });
  if (onElicit) client.setRequestHandler(ElicitRequestSchema, onElicit);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  return { store, server, client, call };
}

test('MCP protocol discovers tools and completes create → preview → confirm → undo → handoff', async (t) => {
  const { call, client, store } = await session(t);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  for (const expected of ['create_trip', 'check_weather', 'propose_change', 'apply_change', 'undo_last_change', 'send_to_phone']) assert.ok(tools.includes(expected));
  const created = await call('create_trip', { city: 'kyoto', days: 2, pace: 'relaxed', interests: ['coffee', 'culture'], startDate: '2026-10-05' });
  assert.ok(!created.isError, JSON.stringify(created));
  const before = store.getTrip();
  const preview = await call('propose_change', { type: 'shift_day', day: 1, minutes: 30 });
  const proposalId = preview.structuredContent.proposal.proposalId;
  assert.deepEqual(store.getTrip(), before);
  const pending = await call('apply_change', { proposalId });
  assert.equal(pending.structuredContent.status, 'needs_confirmation');
  assert.deepEqual(store.getTrip(), before);
  const applied = await call('apply_change', { proposalId, userConfirmed: true });
  assert.equal(applied.structuredContent.status, 'applied');
  assert.notEqual(store.getTrip().stops[0].time, before.stops[0].time);
  const undone = await call('undo_last_change');
  assert.equal(undone.structuredContent.status, 'undone');
  assert.deepEqual(store.getTrip().stops, before.stops);
  const handoff = await call('send_to_phone');
  assert.ok(!handoff.isError, JSON.stringify(handoff));
  assert.match(handoff.structuredContent.url, /\/phone\/#trip=/);
  assert.equal(handoff.structuredContent.reachableFromPhone, false);
  const resource = await client.readResource({ uri: 'trip://current/day/2' });
  assert.equal(JSON.parse(resource.contents[0].text).days[0].day, 2);
});

test('MCP elicitation declines safely and requires actual human form acceptance', async (t) => {
  let response = { action: 'decline' };
  let requested = 0;
  const { call, store } = await session(t, {
    capabilities: { elicitation: { form: {} } },
    onElicit: async (request) => { requested++; assert.match(request.params.message, /Should I update your trip/); return response; },
  });
  await call('create_trip', { city: 'seattle', days: 1, startDate: '2026-10-05' });
  const before = store.getTrip();
  let preview = await call('propose_change', { type: 'shift_day', day: 1, minutes: 30 });
  const declined = await call('apply_change', { proposalId: preview.structuredContent.proposal.proposalId, userConfirmed: true });
  assert.equal(declined.structuredContent.status, 'declined');
  assert.deepEqual(store.getTrip(), before);
  response = { action: 'accept', content: { confirm: true } };
  preview = await call('propose_change', { type: 'shift_day', day: 1, minutes: 30 });
  const applied = await call('apply_change', { proposalId: preview.structuredContent.proposal.proposalId });
  assert.equal(applied.structuredContent.status, 'applied');
  assert.equal(requested, 2);
});

test('default Kyoto demo has actionable rain, previews an unused indoor stop and can undo it', async (t) => {
  const { call, store } = await session(t);
  await call('create_trip', { city: 'kyoto', days: 2, pace: 'relaxed', interests: ['coffee', 'culture'], startDate: '2026-10-05' });
  const before = store.getTrip();
  const weather = await call('check_weather', { day: 1 });
  assert.equal(weather.structuredContent.source, 'demo');
  assert.ok(weather.structuredContent.atRisk.length > 0);
  const preview = await call('propose_change', { type: 'rain_swap', day: 1 });
  assert.ok(!preview.isError, JSON.stringify(preview));
  const proposal = preview.structuredContent.proposal;
  const replacement = proposal.diff.find((change) => change.op === 'replaced');
  assert.ok(replacement);
  await call('apply_change', { proposalId: proposal.proposalId, userConfirmed: true });
  const next = store.getTrip().stops.find((stop) => stop.id === replacement.stopId);
  assert.equal(next.exposure, 'indoor');
  assert.ok(!before.stops.some((stop) => stop.placeId === next.placeId));
  await call('undo_last_change');
  assert.deepEqual(store.getTrip().stops, before.stops);
});

test('MCP validates dates, day bounds, clock values and stale confirmations', async (t) => {
  const { call, store } = await session(t);
  const invalid = await call('create_trip', { city: 'kyoto', startDate: '2026-02-30' });
  assert.equal(invalid.isError, true);
  assert.equal(store.getTrip(), null);
  await call('create_trip', { city: 'kyoto', days: 1, startDate: '2026-10-05' });
  for (const [name, args] of [['get_next_stop', { day: 2 }], ['get_next_stop', { now: '99:99' }], ['get_itinerary', { day: 2 }], ['check_weather', { day: 2 }]]) {
    const invalid = await call(name, args);
    assert.equal(invalid.isError, true, name);
  }
  const preview = await call('propose_change', { type: 'shift_day', day: 1, minutes: 30 });
  await call('mark_visited', { stopId: store.getTrip().stops[0].id });
  const changed = store.getTrip();
  const stale = await call('apply_change', { proposalId: preview.structuredContent.proposal.proposalId, userConfirmed: true });
  assert.equal(stale.isError, true);
  assert.deepEqual(store.getTrip(), changed);
});

test('MCP reports failed/partial forecasts without describing no rain or proposing blanket swaps', async (t) => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => ({ hourly: { time: ['2026-10-05T07:00'], precipitation_probability: [0], precipitation: [0] } }) }),
  ]) {
    const { call, store } = await session(t, { weatherMode: 'live', fetchImpl });
    await call('create_trip', { city: 'kyoto', days: 1, startDate: '2026-10-05' });
    const weather = await call('check_weather', { day: 1 });
    assert.equal(weather.structuredContent.assessmentComplete, false);
    assert.doesNotMatch(weather.content[0].text, /No rain risk|No significant rain/);
    const before = store.getTrip();
    const preview = await call('propose_change', { type: 'rain_swap', day: 1 });
    assert.equal(preview.isError, true);
    assert.equal(store.proposals.size, 0);
    assert.deepEqual(store.getTrip(), before);
    const explicit = await call('propose_change', { type: 'rain_swap', day: 1, from: '09:00', to: '18:00' });
    assert.ok(!explicit.isError, JSON.stringify(explicit));
  }
});

test('a trip changed during an async weather lookup cannot be replaced by a stale proposal', async (t) => {
  const store = new TripStore();
  const newer = createTrip({ city: 'seattle', days: 1, startDate: '2026-10-05' });
  const fetchImpl = async () => {
    store.setTrip(newer);
    return { ok: true, json: async () => ({ hourly: {
      time: Array.from({ length: 24 }, (_, h) => `2026-10-05T${String(h).padStart(2, '0')}:00`),
      precipitation_probability: Array(24).fill(80), precipitation: Array(24).fill(1),
    } }) };
  };
  const { call } = await session(t, { store, weatherMode: 'live', fetchImpl });
  await call('create_trip', { city: 'kyoto', days: 1, startDate: '2026-10-05' });
  const result = await call('propose_change', { type: 'rain_swap', day: 1 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /changed while preparing/);
  assert.equal(store.getTrip().id, newer.id);
  assert.equal(store.proposals.size, 0);
});
