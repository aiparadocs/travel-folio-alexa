import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { normalizeMemories } from '../src/domain/memories.js';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';
const STICKER = 'data:image/webp;base64,UklGRmAdAABXRUJQ';

function home(running) {
  let cookie = null;
  const call = async (route, body) => {
    const response = await fetch(`${running.url}${route}`, body ? { method: 'POST', headers: { ...(cookie ? { cookie } : {}), origin: running.url, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: cookie ? { cookie } : {} });
    cookie ??= response.headers.get('set-cookie')?.split(';')[0] ?? null;
    return { status: response.status, data: await response.json() };
  };
  return { call, get cookie() { return cookie; } };
}

async function pairedHome(running) {
  const browser = home(running);
  await browser.call('/api/state');
  const prepared = await browser.call('/api/action', { action: 'create', city: 'kyoto', days: 2 });
  await browser.call('/api/action', { action: 'confirm', proposalId: prepared.data.proposal.proposalId });
  const handoff = await browser.call('/api/action', { action: 'handoff' });
  const token = new URL(handoff.data.handoff.url).searchParams.get('home');
  assert.match(token, /^[0-9a-f]{32}$/);
  return { browser, token };
}

const share = (running, token, body) => fetch(`${running.url}/api/memories`, { method: 'POST', headers: { 'x-folio-home': token, origin: running.url, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (response) => ({ status: response.status, data: await response.json() }));

const book = {
  title: '2 days in Kyoto', place: 'Kyoto', notes: 'PRIVATE trip note', packing: [{ text: 'passport' }],
  items: [
    { day: 2, time: '10:00', title: 'Kinkaku-ji', caption: 'Gold on a blue afternoon.', photo: PHOTO, stickers: [{ label: 'Fox', data: STICKER }], planNote: 'PRIVATE plan note' },
    { day: 2, title: 'Genko-an', caption: 'A round window full of maples.', photo: PHOTO, stickers: [] },
    { day: 2, title: 'Nothing here', caption: '   ', photo: null, stickers: [] },
  ],
};

test('a paired phone shares memories; the home greets, and the screen shows them through MCP', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const { browser, token } = await pairedHome(running);

  assert.equal((await share(running, '0'.repeat(32), book)).status, 403, 'unpaired phones are refused');
  assert.equal((await share(running, token, { ...book, items: [{ ...book.items[0], photo: 'data:text/html;base64,PHNjcmlwdD4=' }] })).status, 400);
  const sent = await share(running, token, book);
  assert.equal(sent.status, 200);
  assert.equal(sent.data.count, 2, 'empty memories are dropped');

  const state = await browser.call('/api/state');
  assert.deepEqual(state.data.memories, { title: '2 days in Kyoto', count: 2, photos: 2, unseen: true });
  const greeting = await browser.call('/api/action', { action: 'briefing' });
  assert.match(greeting.data.reply, /^Welcome back\. 2 memories from your phone just arrived, with 2 photos\. Shall I show them on the Echo Show\?/);
  assert.equal(greeting.data.suggestion.action, 'memories');
  assert.equal(greeting.data.memories.unseen, false);

  const shown = await browser.call('/api/chat', { message: 'yes' });
  assert.equal(shown.status, 200);
  assert.equal(shown.data.app.tool, 'show_memories');
  const card = (await browser.call('/api/app-call')).data;
  const items = card.result.structuredContent.memories.items;
  assert.deepEqual(items.map((item) => item.title), ['Kinkaku-ji', 'Genko-an']);
  assert.equal(items[0].stickers[0].label, 'Fox');
  assert.ok(!JSON.stringify(card).includes('PRIVATE'), 'private notes, packing and plan notes never reach the home');
  assert.ok(card.result.content[0].text.length < 200, 'images travel in structuredContent only, not in the text for models');

  const japanese = await browser.call('/api/chat', { message: '思い出を見せて', inputMode: 'voice', language: 'ja-JP' });
  assert.match(japanese.data.voiceReply, /思い出を画面に映しました/);
});

test('without shared memories the screen explains how to share them', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const { browser } = await pairedHome(running);
  const response = await browser.call('/api/chat', { message: 'Show our memories' });
  assert.equal(response.status, 400);
  assert.match(response.data.error, /Show on Echo Show/);
});

test('shared memories survive a restart and keep their pairing', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-share-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
  const { browser, token } = await pairedHome(first);
  await first.close();
  const second = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo', dataDir });
  t.after(() => second.close());
  assert.equal((await share(second, token, book)).status, 200, 'the phone stays paired after the home restarts');
  const returning = home(second);
  await returning.call('/api/state'); // new browser: separate home
  const response = await fetch(`${second.url}/api/state`, { headers: { cookie: browser.cookie } });
  assert.equal((await response.json()).memories.count, 2);
});

test('memory books are validated and capped', () => {
  assert.throws(() => normalizeMemories({ items: [] }), /Add a photo/);
  assert.throws(() => normalizeMemories({ items: Array.from({ length: 31 }, () => book.items[0]) }), /up to 30/);
  assert.throws(() => normalizeMemories({ items: [{ ...book.items[0], stickers: [{ label: 'x', data: 'data:image/svg+xml;base64,AAAA' }] }] }), /sticker/);
  const normalized = normalizeMemories({ items: [{ title: 'x'.repeat(200), caption: 'y'.repeat(900), photo: PHOTO, day: 99 }] });
  assert.equal(normalized.items[0].title.length, 80);
  assert.equal(normalized.items[0].caption.length, 600);
  assert.equal(normalized.items[0].day, null);
});

test('a model asking for memories never receives image data', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const { token } = await pairedHome(running);
  // Use a fresh server-side session through the public API, then call modelTool directly.
  assert.equal((await share(running, token, book)).status, 200);
  const { ConversationSession } = await import('../src/agent/session.js');
  const fake = new ConversationSession({ id: 'model', url: 'http://127.0.0.1:1', token: 'x', config: { agentMode: 'bedrock', weatherMode: 'demo', bedrockConfigured: true } });
  fake.tool = async () => ({ data: { memories: { title: 'T', items: [{ day: 2, title: 'Kinkaku-ji', caption: 'c', photo: PHOTO, stickers: [{ label: 'Fox', data: STICKER }] }] } }, text: 'Showing 1 memory' });
  const result = await fake.modelTool('show_memories', {});
  assert.deepEqual(result, { shownOnScreen: true, title: 'T', memories: [{ day: 2, title: 'Kinkaku-ji', caption: 'c' }] });
  assert.ok(!JSON.stringify(result).includes('base64'));
  await fake.close();
});
