import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { decompress } from '../src/handoff.js';
import { converseWithTools } from '../src/agent/bedrock.js';
import { parseGuided } from '../src/agent/guided.js';
import { ConversationSession } from '../src/agent/session.js';

async function browser(running) {
  const initial = await fetch(`${running.url}/api/state`);
  assert.equal(initial.status, 200);
  const cookie = initial.headers.get('set-cookie').split(';')[0];
  assert.match(initial.headers.get('set-cookie'), /HttpOnly/);
  assert.match(initial.headers.get('set-cookie'), /SameSite=Strict/);
  return {
    cookie,
    state: async () => (await fetch(`${running.url}/api/state`, { headers: { cookie } })).json(),
    async post(body, route = 'action') {
      const response = await fetch(`${running.url}/api/${route}`, { method: 'POST', headers: { cookie, origin: running.url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    },
  };
}

test('real HTTP MCP end-to-end: confirmation, isolation, changes, undo, QR, and reload', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const a = await browser(running);
  const b = await browser(running);
  const prepared = await a.post({ action: 'create', city: 'kyoto', days: 2, pace: 'relaxed', interests: ['coffee', 'culture'] });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.data.trip, null);
  assert.equal(prepared.data.proposal.kind, 'create');
  assert.equal((await a.state()).proposal.proposalId, prepared.data.proposal.proposalId);
  assert.equal((await b.state()).proposal, null);
  const humanYes = await a.post({ message: 'yes' }, 'chat');
  assert.equal(humanYes.data.trip, null, 'confirmation needs the proposal-specific button');
  assert.equal((await a.post({ action: 'confirm', proposalId: 'wrong' })).status, 409);
  const created = await a.post({ action: 'confirm', proposalId: prepared.data.proposal.proposalId });
  assert.equal(created.status, 200);
  assert.equal(created.data.trip.city, 'kyoto');
  assert.equal(created.data.trip.days.length, 2);
  assert.ok(created.data.trace.some((entry) => entry.tool === 'create_trip' && entry.ok));
  assert.equal((await b.state()).trip, null);
  const baseline = created.data.trip.days[0].stops[0].time;
  const proposed = await a.post({ action: 'delay', day: 1, minutes: 30 });
  assert.equal(proposed.data.trip.days[0].stops[0].time, baseline);
  assert.ok(proposed.data.proposal.diff.length);
  const applied = await a.post({ action: 'confirm', proposalId: proposed.data.proposal.proposalId });
  assert.notEqual(applied.data.trip.days[0].stops[0].time, baseline);
  assert.equal((await a.post({ action: 'confirm', proposalId: proposed.data.proposal.proposalId })).status, 409);
  const undo = await a.post({ action: 'undo' });
  assert.equal(undo.data.trip.days[0].stops[0].time, baseline);
  const weather = await a.post({ action: 'weather', day: 1 });
  assert.equal(weather.status, 200);
  assert.equal(weather.data.weather.source, 'demo');
  assert.ok(weather.data.weather.atRisk.length, 'the first-run demo includes an actual rainy-day alternative');
  const indoor = await a.post({ action: 'rain_swap', day: 1 });
  assert.equal(indoor.status, 200);
  assert.equal(indoor.data.proposal.kind, 'change');
  assert.ok(indoor.data.proposal.diff.some((entry) => entry.op === 'replaced'));
  const indoorsApplied = await a.post({ action: 'confirm', proposalId: indoor.data.proposal.proposalId });
  assert.equal(indoorsApplied.status, 200);
  assert.equal((await a.post({ action: 'undo' })).status, 200);
  const handoff = await a.post({ action: 'handoff' });
  assert.equal(handoff.status, 200);
  assert.equal(handoff.data.handoff.reachableFromPhone, false);
  assert.match(handoff.data.handoff.qrSvg, /<svg/);
  const packed = JSON.parse(decompress(new URL(handoff.data.handoff.url).hash.slice('#trip='.length)));
  assert.equal(packed[0], 2);
  assert.equal(packed[2], 'Kyoto');
  assert.match(handoff.data.handoff.qrUrl, /\/t\/[A-Za-z0-9_-]{12}$/, 'the QR carries a short link');
  const hop = await fetch(handoff.data.handoff.qrUrl, { redirect: 'manual' });
  assert.equal(hop.status, 302);
  assert.equal(hop.headers.get('location'), handoff.data.handoff.url, 'the short link opens the full plan link');
  assert.equal((await fetch(`${running.url}/t/not-a-real-code`, { redirect: 'manual' })).status, 404);
  const replacement = await a.post({ action: 'create', city: 'seattle' });
  assert.equal(replacement.data.trip.city, 'kyoto');
  const declined = await a.post({ action: 'decline' });
  assert.equal(declined.data.proposal, null);
  assert.equal(declined.data.trip.city, 'kyoto');
  const unsupported = await a.post({ message: 'Book me a hotel in Lisbon' }, 'chat');
  assert.match(unsupported.data.reply, /cannot research/);
  assert.equal(unsupported.data.trip.city, 'kyoto');
});

test('mutations reject cross-origin, missing Origin, malformed input, and unauthenticated MCP', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const a = await browser(running);
  for (const origin of [undefined, 'https://attacker.invalid']) {
    const response = await fetch(`${running.url}/api/action`, { method: 'POST', headers: { cookie: a.cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify({ action: 'create' }) });
    assert.equal(response.status, 403);
  }
  const mcp = await fetch(`${running.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(mcp.status, 401);
  assert.equal((await a.post({ action: 'create', days: 300 })).status, 400);
  assert.equal((await a.post({ action: 'create', startDate: '2026-02-30' })).status, 400);
  assert.equal((await a.post({ message: 'x'.repeat(2001) }, 'chat')).status, 400);
  const badJson = await fetch(`${running.url}/api/action`, { method: 'POST', headers: { cookie: a.cookie, origin: running.url, 'content-type': 'application/json' }, body: '{' });
  assert.equal(badJson.status, 400);
  assert.match((await badJson.json()).error, /valid JSON/);
  assert.equal((await a.state()).trip, null);
});

test('concurrent confirmations cannot apply twice or replace another proposal', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const a = await browser(running);
  const p = await a.post({ action: 'create', city: 'kyoto' });
  const replies = await Promise.all([a.post({ action: 'confirm', proposalId: p.data.proposal.proposalId }), a.post({ action: 'confirm', proposalId: p.data.proposal.proposalId })]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  const old = await a.post({ action: 'delay', minutes: 30 });
  const next = await a.post({ action: 'delay', minutes: 60 });
  assert.equal((await a.post({ action: 'confirm', proposalId: old.data.proposal.proposalId })).status, 409);
  assert.equal((await a.post({ action: 'decline', proposalId: old.data.proposal.proposalId })).status, 409);
  assert.equal((await a.state()).proposal.proposalId, next.data.proposal.proposalId);
});

test('Bedrock adapter sends only type, properties and required at the top of a tool schema', async () => {
  // Amazon Nova rejects other top-level keys such as $schema with a ValidationException.
  let request;
  await converseWithTools({
    modelId: 'test-model', region: 'test-region', messages: [{ role: 'user', text: 'Plan Kyoto' }], context: {},
    tools: [
      { name: 'create_trip', inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', title: 'x', additionalProperties: false, properties: { city: { type: 'string', enum: ['kyoto'] } }, required: ['city'] } },
      { name: 'get_itinerary', inputSchema: { type: 'object', $schema: 'http://json-schema.org/draft-07/schema#' } },
    ],
    execute: async () => ({}),
    send: async (input) => { request = structuredClone(input); return { output: { message: { role: 'assistant', content: [{ text: 'ok' }] } } }; },
  });
  const [create, itinerary] = request.toolConfig.tools.map((tool) => tool.toolSpec.inputSchema.json);
  assert.deepEqual(create, { type: 'object', properties: { city: { type: 'string', enum: ['kyoto'] } }, required: ['city'] });
  assert.deepEqual(itinerary, { type: 'object', properties: {} });
});

test('Bedrock adapter sends tool results and rejects model-generated confirmation', async () => {
  const requests = [];
  const executed = [];
  const reply = await converseWithTools({
    modelId: 'test-model', region: 'test-region', messages: [{ role: 'user', text: 'Plan Kyoto' }], context: {},
    tools: [
      { name: 'create_trip', inputSchema: { type: 'object' } },
      { name: 'apply_change', inputSchema: { type: 'object' } },
    ],
    execute: async (name) => { executed.push(name); return { status: 'needs_confirmation' }; },
    send: async (input) => {
      requests.push(structuredClone(input));
      return requests.length === 1 ? { output: { message: { role: 'assistant', content: [
        { toolUse: { toolUseId: 'create', name: 'create_trip', input: { city: 'kyoto' } } },
        { toolUse: { toolUseId: 'self-confirm', name: 'apply_change', input: { userConfirmed: true } } },
      ] } } } : { output: { message: { role: 'assistant', content: [{ text: 'Please review the proposal.' }] } } };
    },
  });
  assert.deepEqual(executed, ['create_trip']);
  assert.equal(reply, 'Please review the proposal.');
  assert.deepEqual(requests[0].toolConfig.tools.map((tool) => tool.toolSpec.name), ['create_trip']);
  const results = requests[1].messages.at(-1).content;
  assert.equal(results[0].toolResult.status, 'success');
  assert.equal(results[1].toolResult.status, 'error');
  assert.match(results[1].toolResult.content[0].json.error, /human action/);
});

test('Bedrock create is intercepted as a proposal and cannot overwrite the itinerary', async (t) => {
  let count = 0;
  const running = await startServer({
    port: 0, agentMode: 'bedrock', weatherMode: 'demo', bedrockModelId: 'test-model', region: 'test-region',
    bedrockSend: async () => ++count === 1
      ? { output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'one', name: 'create_trip', input: { city: 'kyoto' } } }] } } }
      : { output: { message: { role: 'assistant', content: [{ text: 'Your trip is created!' }] } } },
  });
  t.after(() => running.close());
  const a = await browser(running);
  const reply = await a.post({ message: 'Please help plan a Kyoto trip.' }, 'chat');
  assert.equal(reply.status, 200);
  assert.equal(reply.data.trip, null);
  assert.equal(reply.data.proposal.kind, 'create');
  assert.match(reply.data.reply, /use Confirm/);
  assert.ok(!reply.data.trace.some((entry) => entry.tool === 'create_trip'));
  const created = await a.post({ action: 'confirm', proposalId: reply.data.proposal.proposalId });
  assert.equal(created.data.trip.city, 'kyoto');
  assert.equal(count, 2, 'confirmation does not call a cloud model');
});

test('Bedrock is told today\'s date in each city, so "this Saturday" is not guessed', async (t) => {
  let system;
  const running = await startServer({
    port: 0, agentMode: 'bedrock', weatherMode: 'demo', bedrockModelId: 'test-model', region: 'test-region',
    bedrockSend: async (input) => { system = input.system[0].text; return { output: { message: { role: 'assistant', content: [{ text: 'Which day?' }] } } }; },
  });
  t.after(() => running.close());
  const a = await browser(running);
  assert.equal((await a.post({ message: 'Plan Kyoto from this Saturday.' }, 'chat')).status, 200);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'long' }).format(new Date());
  assert.ok(system.includes(`"kyoto":"${today} (${weekday})"`), system);
  assert.match(system, /"seattle":"\d{4}-\d{2}-\d{2} \(\w+day\)"/);
  assert.match(system, /relative dates/i);
});

test('guided bilingual commands and model loop have strict bounds', async () => {
  assert.deepEqual(parseGuided('京都に2日間、のんびりカフェと文化'), { action: 'create', city: 'kyoto', days: 2, pace: 'relaxed', interests: ['coffee', 'culture'] });
  assert.deepEqual(parseGuided('Delay day two by one hour'), { action: 'delay', day: 2, minutes: 60 });
  assert.deepEqual(parseGuided('1日目を30分早めて'), { action: 'delay', day: 1, minutes: -30 });
  let rounds = 0;
  await converseWithTools({ modelId: 'test', region: 'test', context: {}, messages: [{ role: 'user', text: 'loop' }], tools: [{ name: 'get_itinerary', inputSchema: { type: 'object' } }], execute: async () => ({}), send: async () => {
    rounds++;
    return { output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: String(rounds), name: 'get_itinerary', input: {} } }] } } };
  } });
  assert.equal(rounds, 4);
});

test('a Bedrock day-filtered read does not truncate the full UI itinerary', async (t) => {
  let rounds = 0;
  const running = await startServer({
    port: 0, agentMode: 'bedrock', weatherMode: 'demo', bedrockModelId: 'test', region: 'test',
    bedrockSend: async () => ++rounds === 1
      ? { output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'day', name: 'get_itinerary', input: { day: 2 } } }] } } }
      : { output: { message: { role: 'assistant', content: [{ text: 'Here is your second day.' }] } } },
  });
  t.after(() => running.close());
  const a = await browser(running);
  const proposal = await a.post({ action: 'create', city: 'kyoto', days: 3 });
  await a.post({ action: 'confirm', proposalId: proposal.data.proposal.proposalId });
  const read = await a.post({ message: 'What is planned for day two?' }, 'chat');
  assert.equal(read.status, 200);
  assert.deepEqual(read.data.trip.days.map((day) => day.day), [1, 2, 3]);
  const thirdDay = await a.post({ action: 'weather', day: 3 });
  assert.equal(thirdDay.status, 200);
  assert.equal(thirdDay.data.weather.day, 3);
});

test('expired or incomplete proposals never block a new Bedrock request or expose stale confirmation', async () => {
  const session = new ConversationSession({ id: 'test', url: 'http://127.0.0.1:1', token: 'test', config: { agentMode: 'guided', weatherMode: 'demo', bedrockConfigured: false } });
  session.prepareCreate({ city: 'kyoto' });
  session.proposal.expiresAt = '2000-01-01T00:00:00Z';
  const requested = await session.modelTool('create_trip', { city: 'seattle' });
  assert.equal(requested.proposal.details.city, 'seattle');
  assert.equal(session.snapshot().proposal.details.city, 'seattle');
  session.proposal.expiresAt = '2000-01-01T00:00:00Z';
  const yes = await session.chat('yes');
  assert.equal(yes.proposal, null);
  assert.match(yes.reply, /no pending proposal/);
  session.proposal = { proposalId: 'broken', kind: 'create' };
  assert.equal(session.snapshot().proposal, null);
  session.prepareCreate({ city: 'kyoto' });
  session.trip = { tripId: 'newer', version: 99 };
  assert.equal(session.snapshot().proposal, null, 'base-version drift also clears stale UI confirmation');
  await session.close();
});

test('Bedrock failure after preparing a proposal leaves a recoverable confirmation without applying it', async (t) => {
  let calls = 0;
  const running = await startServer({
    port: 0, agentMode: 'bedrock', weatherMode: 'demo', bedrockModelId: 'test', region: 'test',
    bedrockSend: async () => {
      if (++calls > 1) throw new Error('Simulated model outage');
      return { output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'draft', name: 'create_trip', input: { city: 'seattle' } } }] } } };
    },
  });
  t.after(() => running.close());
  const a = await browser(running);
  const failed = await a.post({ message: 'Plan a trip' }, 'chat');
  assert.equal(failed.status, 502);
  assert.match(failed.data.error, /No changes were applied/);
  const recovered = await a.state();
  assert.equal(recovered.trip, null);
  assert.equal(recovered.proposal.details.city, 'seattle');
  const confirmed = await a.post({ action: 'confirm', proposalId: recovered.proposal.proposalId });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.trip.city, 'seattle');
  assert.equal(calls, 2);
});

test('an occupied port reports EADDRINUSE and can be reused after clean shutdown', async (t) => {
  const first = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => first.close());
  const port = first.server.address().port;
  await assert.rejects(startServer({ port, agentMode: 'guided', weatherMode: 'demo' }), { code: 'EADDRINUSE' });
  assert.equal((await fetch(`${first.url}/api/state`)).status, 200);
  await first.close();
  const restarted = await startServer({ port, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => restarted.close());
  assert.equal((await fetch(`${restarted.url}/api/state`)).status, 200);
});
