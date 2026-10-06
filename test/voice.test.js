import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, lanAddresses } from '../src/server.js';
import { ConversationSession } from '../src/agent/session.js';
import { isVoiceConfirmation, parseGuided } from '../src/agent/guided.js';

async function browser(running) {
  const initial = await fetch(`${running.url}/api/state`);
  const cookie = initial.headers.get('set-cookie').split(';')[0];
  return {
    state: async () => (await fetch(`${running.url}/api/state`, { headers: { cookie } })).json(),
    async post(body, endpoint = 'chat') {
      const response = await fetch(`${running.url}/api/${endpoint}`, { method: 'POST', headers: { cookie, origin: running.url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    },
    async voice(message, extra = {}) { return this.post({ message, inputMode: 'voice', language: 'ja-JP', ...extra }); },
  };
}

test('Japanese voice opens, plans, confirms the spoken proposal, checks weather and generates a handoff', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const a = await browser(running);
  const open = await a.voice('旅の手帳を開いて');
  assert.equal(open.status, 200);
  assert.match(open.data.voiceReply, /京都とシアトル/);
  assert.equal(open.data.voiceLanguage, 'ja-JP');
  assert.equal(open.data.voiceProposalId, null);
  assert.equal(open.data.voiceHandoffReady, false);
  const draft = await a.voice('京都に2日間、カフェ多めでゆっくり');
  assert.equal(draft.status, 200);
  assert.equal(draft.data.trip, null);
  assert.equal(draft.data.proposal.details.city, 'kyoto');
  assert.equal(draft.data.proposal.details.pace, 'relaxed');
  assert.deepEqual(draft.data.proposal.details.interests, ['coffee']);
  assert.match(draft.data.voiceReply, /2日間/);
  assert.match(draft.data.voiceReply, /京都/);
  assert.match(draft.data.voiceReply, /カフェ/);
  assert.match(draft.data.voiceReply, /作成しますか/);
  assert.equal(draft.data.voiceProposalId, draft.data.proposal.proposalId);
  const prematurePhone = await a.voice('スマホで開きたい');
  assert.equal(prematurePhone.data.handoff, null);
  assert.equal(prematurePhone.data.voiceHandoffReady, false);
  assert.equal(prematurePhone.data.voiceProposalId, draft.data.proposal.proposalId);
  const yes = await a.voice('はい。', { proposalId: draft.data.voiceProposalId });
  assert.equal(yes.status, 200);
  assert.equal(yes.data.trip.city, 'kyoto');
  assert.equal(yes.data.proposal, null);
  assert.equal(yes.data.voiceProposalId, null);
  assert.match(yes.data.voiceReply, /作成しました/);
  const weather = await a.voice('天気');
  assert.equal(weather.data.weather.source, 'demo');
  assert.match(weather.data.voiceReply, /サンプル天気/);
  assert.equal(weather.data.voiceProposalId, null);
  const transfer = await a.voice('スマホで開きたい');
  assert.equal(transfer.status, 200);
  assert.match(transfer.data.handoff.url, /\/phone\/\?home=[0-9a-f]{32}#trip=/, 'the link pairs the phone with this home for sharing memories back');
  assert.equal(transfer.data.voiceHandoffReady, true);
  assert.equal(transfer.data.voiceProposalId, null);
  assert.match(transfer.data.voiceReply, /このPCだけ/);
  const laterWeather = await a.voice('天気');
  assert.equal(laterWeather.data.voiceHandoffReady, false, 'an old handoff does not end a later conversation');
});

test('voice confirmation requires a current exact ID; text, missing, null, stale and qualified yes cannot apply', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const a = await browser(running);
  const draft = await a.voice('京都に2日間');
  const id = draft.data.voiceProposalId;
  const typed = await a.post({ message: 'はい', proposalId: id });
  assert.equal(typed.data.trip, null);
  for (const extra of [{}, { proposalId: null }, { proposalId: 'old-spoken-id' }]) {
    const response = await a.voice('はい', extra);
    assert.equal(response.status, 200);
    assert.equal(response.data.trip, null);
    assert.equal(response.data.voiceProposalId, id);
    assert.match(response.data.voiceReply, /まだ反映していません/);
  }
  for (const message of ['yes, but change the date', 'I said yes before', 'はい、でも変更して', 'はいではありません', 'yes please but not today']) {
    const response = await a.voice(message, { proposalId: id });
    assert.equal(response.data.trip, null, `${message} must not confirm`);
  }
  const changed = await a.voice('シアトルに3日間');
  const stale = await a.voice('はい', { proposalId: id });
  assert.equal(stale.data.trip, null);
  assert.equal(stale.data.voiceProposalId, changed.data.voiceProposalId);
  const yes = await a.voice('それでお願い！', { proposalId: changed.data.voiceProposalId });
  assert.equal(yes.data.trip.city, 'seattle');
  assert.equal(yes.data.trip.days.length, 3);
  assert.equal((await a.voice('はい', { proposalId: changed.data.voiceProposalId })).data.voiceProposalId, null);
});

test('voice repeat reads the exact proposal, cancel preserves trip, and confirmed changes use the diff', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const a = await browser(running);
  const draft = await a.voice('京都に二日間、ゆっくり');
  assert.equal(draft.data.proposal.details.days, 2);
  const repeated = await a.voice('もう一度');
  assert.equal(repeated.data.voiceReply, draft.data.voiceReply);
  const cancelled = await a.voice('やめる', { proposalId: draft.data.voiceProposalId });
  assert.equal(cancelled.data.trip, null);
  assert.equal(cancelled.data.proposal, null);
  assert.match(cancelled.data.voiceReply, /キャンセルしました/);
  const created = await a.voice('京都に2日間、カフェ多めでゆっくり');
  const applied = await a.voice('はい', { proposalId: created.data.voiceProposalId });
  const originalTime = applied.data.trip.days[0].stops[0].time;
  const delay = await a.voice('1日目を30分遅らせて');
  assert.match(delay.data.voiceReply, /30分遅らせます/);
  assert.match(delay.data.voiceReply, /変更を反映しますか/);
  assert.equal(delay.data.trip.days[0].stops[0].time, originalTime);
  const oldId = delay.data.voiceProposalId;
  const updated = await a.voice('1日目を60分遅らせて');
  assert.equal((await a.voice('いいえ', { proposalId: oldId })).status, 409);
  const current = await a.state();
  assert.equal(current.proposal.proposalId, updated.data.voiceProposalId);
  const yes = await a.voice('はい', { proposalId: updated.data.voiceProposalId });
  assert.notEqual(yes.data.trip.days[0].stops[0].time, originalTime);
  assert.match(yes.data.voiceReply, /変更を反映しました/);
});

test('English voice and invalid voice metadata have explicit responses', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const a = await browser(running);
  const draft = await a.voice('Plan a relaxed two-day Kyoto trip with coffee', { language: 'en-US' });
  assert.equal(draft.data.voiceLanguage, 'en-US');
  assert.match(draft.data.voiceReply, /2-day Kyoto/);
  assert.match(draft.data.voiceReply, /Say yes/);
  const yes = await a.voice('Yes, use this plan!', { language: 'en-US', proposalId: draft.data.voiceProposalId });
  assert.equal(yes.data.trip.city, 'kyoto');
  assert.match(yes.data.voiceReply, /plan is ready/);
  assert.equal((await a.voice('yes', { proposalId: 12 })).status, 400);
  assert.equal((await a.voice('yes', { language: 'fr-FR' })).status, 400);
  const error = await a.voice('5日目を30分遅らせて');
  assert.equal(error.status, 400);
  assert.equal(error.data.voiceProposalId, null);
  assert.equal(error.data.voiceHandoffReady, false);
  assert.equal(error.data.voiceLanguage, 'ja-JP');
});

test('expired voice references never reach confirmation tools', async () => {
  const session = new ConversationSession({ id: 'voice-test', url: 'http://127.0.0.1:1', token: 'test', config: { agentMode: 'guided', weatherMode: 'demo', bedrockConfigured: false } });
  session.prepareCreate({ city: 'kyoto' });
  const id = session.proposal.proposalId;
  session.proposal.expiresAt = '2000-01-01T00:00:00Z';
  const response = await session.chat('はい', { inputMode: 'voice', language: 'ja-JP', proposalId: id });
  assert.equal(response.trip, null);
  assert.equal(response.proposal, null);
  assert.equal(response.voiceProposalId, null);
  assert.match(response.voiceReply, /確認待ちの提案がありません/);
  assert.equal(response.trace.length, 0);
  await session.close();
});

test('Bedrock cannot turn a model-generated yes into voice confirmation', async (t) => {
  let rounds = 0;
  const running = await startServer({
    port: 0, agentMode: 'bedrock', weatherMode: 'demo', bedrockModelId: 'test', region: 'test',
    bedrockSend: async () => ++rounds === 1
      ? { output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'unauthorized', name: 'apply_change', input: { userConfirmed: true, proposalId: 'model-chosen' } } }] } } }
      : { output: { message: { role: 'assistant', content: [{ text: 'はい。変更しました。' }] } } },
  });
  t.after(() => running.close());
  const a = await browser(running);
  const draft = await a.voice('京都に2日間');
  assert.equal(rounds, 0, 'supported guided voice commands need no model call');
  const fabricated = await a.voice('もっといい感じにして', { proposalId: draft.data.voiceProposalId });
  assert.equal(fabricated.status, 200);
  assert.equal(fabricated.data.trip, null);
  assert.equal(fabricated.data.proposal.proposalId, draft.data.voiceProposalId);
  assert.match(fabricated.data.voiceReply, /作成しますか/);
  assert.ok(!fabricated.data.trace.some((entry) => entry.tool === 'apply_change'));
  const actualHuman = await a.voice('はい', { proposalId: draft.data.voiceProposalId });
  assert.equal(actualHuman.data.trip.city, 'kyoto');
  assert.equal(rounds, 2);
});

test('phone handoff prefers a physical private LAN adapter over VPN and virtual addresses', () => {
  const entry = (address) => ({ address, family: 'IPv4', internal: false });
  assert.deepEqual(lanAddresses({
    'vEthernet (WSL)': [entry('172.28.160.1')],
    Tailscale: [entry('100.64.0.10')],
    'Wi-Fi': [entry('192.168.1.20')],
    Ethernet: [entry('169.254.10.2')],
    Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  }), ['192.168.1.20', '172.28.160.1', '100.64.0.10', '169.254.10.2']);
});

test('UI-spoken affirmative variants match completely, while qualifications and reported speech do not', () => {
  for (const message of ['Yes, use this plan.', 'yes please', 'Yes, apply these changes!', 'はい、お願いします。', 'うん、それでお願い', 'はい、それでお願いします', 'それでお願い']) assert.equal(isVoiceConfirmation(message), true, message);
  for (const message of ['yes, but change the date', 'yes please but not this plan', 'I said yes before', 'はい、でも日付を変えて', 'はいとは言っていません', 'うん、それでお願いしたかったけど', 'もう一度', 'やめる']) assert.equal(isVoiceConfirmation(message), false, message);
});

test('the UI example and numbered easy or relaxed days retain the requested duration and pace', () => {
  const example = parseGuided('Plan two easy days in Kyoto');
  assert.equal(example.days, 2);
  assert.equal(example.pace, 'relaxed');
  for (const message of ['Plan three easy days in Kyoto', 'Three relaxed days in Seattle']) {
    const parsed = parseGuided(message);
    assert.equal(parsed.days, 3);
    assert.equal(parsed.pace, 'relaxed');
  }
});

test('spoken changes include every replacement, nonuniform resulting time, and material warning in both languages', async () => {
  const session = new ConversationSession({ id: 'diff-test', url: 'http://127.0.0.1:1', token: 'test', config: { agentMode: 'guided', weatherMode: 'demo', bedrockConfigured: false } });
  session.trip = { tripId: 'trip', version: 1 };
  session.proposal = {
    proposalId: 'proposal', kind: 'change', tripId: 'trip', baseVersion: 1,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    summary: 'Three replacements, one more change and adjusted later stops.',
    diff: [
      ...Array.from({ length: 4 }, (_, index) => ({ op: 'replaced', day: 1, before: { title: `Old stop ${index}` }, after: { title: `New stop ${index}`, time: `${10 + index}:15` } })),
      { op: 'moved', day: 1, before: { title: 'Coffee', time: '14:00' }, after: { title: 'Coffee', time: '14:40' } },
      { op: 'moved', day: 1, before: { title: 'Dinner', time: '18:00' }, after: { title: 'Dinner', time: '19:10' } },
    ],
    warnings: ['"Last train" is fixed at 22:00, but the plan would reach it around 22:40.', 'Day 1 now runs past 11 PM.', 'No unused indoor option near "Garden".'],
  };
  for (const language of ['en-US', 'ja-JP']) {
    const response = session.voiceResponse('Summary', { language });
    assert.equal(response.voiceProposalId, 'proposal');
    for (const text of ['New stop 0', 'New stop 1', 'New stop 2', 'New stop 3', '13:15', 'Coffee', '14:40', 'Dinner', '19:10', 'Last train', '22:00', '22:40', 'Garden']) assert.ok(response.voiceReply.includes(text), `${language}: ${text}`);
    assert.match(response.voiceReply, language === 'ja-JP' ? /夜11時を過ぎます/ : /past 11 PM/);
    assert.doesNotMatch(response.voiceReply, /画面に表示しています|more change/);
  }
  await session.close();
});
