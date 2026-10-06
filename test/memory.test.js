import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';

function client(running, cookie = null) {
  const headers = () => (cookie ? { cookie } : {});
  return {
    get cookie() { return cookie; },
    async state() {
      const response = await fetch(`${running.url}/api/state`, { headers: headers() });
      cookie ??= response.headers.get('set-cookie')?.split(';')[0] ?? null;
      return response.json();
    },
    async post(body, route = 'action') {
      const response = await fetch(`${running.url}/api/${route}`, { method: 'POST', headers: { ...headers(), origin: running.url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    },
  };
}

async function createKyoto(browser) {
  await browser.state();
  const prepared = await browser.post({ action: 'create', city: 'kyoto', days: 2, pace: 'relaxed', interests: ['coffee', 'culture'] });
  const created = await browser.post({ action: 'confirm', proposalId: prepared.data.proposal.proposalId });
  assert.equal(created.status, 200);
  return created.data.trip;
}

test('a saved home plan survives a server restart and greets the returning browser', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-memory-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
  const browser = client(first);
  const trip = await createKyoto(browser);
  assert.equal((await browser.state()).briefingDue, false, 'no greeting during the visit that created the plan');
  await first.close();
  assert.equal(fs.readdirSync(path.join(dataDir, 'homes')).length, 1);

  const second = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
  t.after(() => second.close());
  const returning = client(second, browser.cookie);
  const restored = await returning.state();
  assert.equal(restored.trip.tripId, trip.tripId);
  assert.deepEqual(restored.trip.days.map((day) => day.stops.length), trip.days.map((day) => day.stops.length));
  assert.equal(restored.briefingDue, true);
  assert.ok(restored.trace.some((entry) => entry.tool === 'get_itinerary' && entry.ok), 'restoring reads the plan through MCP');

  const briefing = await returning.post({ action: 'briefing' });
  assert.equal(briefing.status, 200);
  assert.match(briefing.data.reply, /^Welcome back\. Your 2-day Kyoto trip starts tomorrow\./);
  assert.match(briefing.data.reply, /sample weather shows rain/i);
  assert.deepEqual(briefing.data.suggestion, { action: 'rain_swap', day: 1, label: 'Find indoor alternatives for day 1' });
  assert.equal(briefing.data.briefingDue, false);
  assert.equal(briefing.data.proposal, null, 'the greeting offers but never prepares a change');
  assert.equal((await returning.state()).briefingDue, false, 'one greeting per return');

  const accepted = await returning.post({ message: 'yes' }, 'chat');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.proposal.kind, 'change', 'yes to the offer prepares the indoor proposal');
  assert.ok(accepted.data.proposal.diff.some((entry) => entry.op === 'replaced'));
  assert.equal(accepted.data.trip.version, restored.trip.version, 'the plan is unchanged until the proposal is confirmed');
  assert.equal(accepted.data.suggestion, null);
  const applied = await returning.post({ action: 'confirm', proposalId: accepted.data.proposal.proposalId });
  assert.equal(applied.status, 200);
  assert.ok(applied.data.trip.version > restored.trip.version);

  const stranger = client(second);
  assert.equal((await stranger.state()).trip, null, 'other browsers do not see this plan');
});

test('declining a welcome-back offer changes nothing and the offer expires after one turn', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-memory-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
  const browser = client(first);
  const trip = await createKyoto(browser);
  await first.close();
  const second = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
  t.after(() => second.close());
  const returning = client(second, browser.cookie);
  await returning.state();
  assert.ok((await returning.post({ action: 'briefing' })).data.suggestion);
  const declined = await returning.post({ message: 'no' }, 'chat');
  assert.equal(declined.data.proposal, null);
  assert.equal(declined.data.suggestion, null);
  assert.equal(declined.data.trip.version, trip.version);
  const laterYes = await returning.post({ message: 'yes' }, 'chat');
  assert.equal(laterYes.data.proposal, null, 'a stale offer cannot be accepted later');
});

test('a damaged saved plan is left untouched and the browser starts fresh', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-memory-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const id = '11111111-2222-3333-4444-555555555555';
  fs.mkdirSync(path.join(dataDir, 'homes'), { recursive: true });
  const damaged = path.join(dataDir, 'homes', `${id}.json`);
  fs.writeFileSync(damaged, '{ not json');
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
  t.after(() => running.close());
  const response = await fetch(`${running.url}/api/state`, { headers: { cookie: `travel_folio_session=${id}` } });
  assert.equal(response.status, 200);
  assert.doesNotMatch(response.headers.get('set-cookie'), new RegExp(id));
  assert.equal((await response.json()).trip, null);
  assert.equal(fs.readFileSync(damaged, 'utf8'), '{ not json');
});

test('without a data directory nothing is written and no greeting is offered', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const browser = client(running);
  await createKyoto(browser);
  const state = await browser.state();
  assert.equal(state.config.remembers, false);
  assert.equal(state.briefingDue, false);
});

test('the greeting follows the destination calendar: during the trip and after it', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-memory-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const weekAgo = new Date(`${today}T12:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const cases = [
    { startDate: today, expect: /^Welcome back\. Today is day 1 of your Kyoto trip\. Next up: .+ at \d{2}:\d{2}\./ },
    { startDate: weekAgo.toISOString().slice(0, 10), expect: /^Welcome back\. Your Kyoto trip has finished\./ },
  ];
  for (const { startDate, expect } of cases) {
    const first = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
    const browser = client(first);
    await browser.state();
    const prepared = await browser.post({ action: 'create', city: 'kyoto', days: 2, startDate });
    assert.equal((await browser.post({ action: 'confirm', proposalId: prepared.data.proposal.proposalId })).status, 200);
    await first.close();
    const second = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
    const returning = client(second, browser.cookie);
    await returning.state();
    const briefing = await returning.post({ action: 'briefing' });
    await second.close();
    assert.match(briefing.data.reply, expect);
  }
});
