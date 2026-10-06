import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTrip } from '../src/domain/planner.js';
import { phoneLink } from '../src/handoff.js';

const html = fs.readFileSync(new URL('../public/phone/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const context = vm.createContext({ TextEncoder, TextDecoder, URL });
for (const script of scripts.filter(s => s.includes('else root.Journey = api') || s.includes('else root.JourneyTransfer=api'))) {
  vm.runInContext(script, context);
}
const { Journey: J, JourneyTransfer: T } = context;

test('every inline phone script parses, including the storage rescue code', () => {
  for (const s of scripts.filter(s => !s.startsWith('{'))) assert.doesNotThrow(() => new vm.Script(s));
});

test('server handoff decodes through the actual phone app without private data', () => {
  const trip = createTrip({ city: 'kyoto', days: 2, interests: ['coffee', 'culture'] });
  trip.stops[0].caption = 'Private memory';
  trip.stops[0].photo = 'PRIVATE-PHOTO';
  trip.stops[0].done = true;
  trip.stops[0].locked = true;
  const url = phoneLink(trip, 'http://192.168.1.5:3000');
  const book = T.decode(new URL(url).hash.slice(6));
  assert.equal(book.title, trip.title);
  assert.equal(book.stops.length, trip.stops.length);
  assert.equal(book.stops[0].locked, true);
  assert.equal(book.stops[0].caption, '');
  assert.equal(book.stops[0].photo, null);
  assert.equal(book.stops[0].done, false);
  assert.equal(book.notes, '');
  assert.equal(book.packing.length, 0);
});

test('Japanese notes round trip through server handoff and phone decoder', () => {
  const trip = createTrip({ city: 'kyoto', days: 1 });
  trip.title = '京都でゆっくり ☕';
  trip.stops[0].note = '写真を撮ったら、カフェでひと休み。';
  const book = T.decode(new URL(phoneLink(trip, 'http://localhost:3000')).hash.slice(6));
  assert.equal(book.title, trip.title);
  assert.equal(book.stops[0].planNote, trip.stops[0].note);
});

test('malformed transfers are rejected without producing a journal', () => {
  for (const code of ['!', 'A', '____', 'A'.repeat(12002)]) assert.throws(() => T.decode(code));
});

test('32 sticker assets are embedded and journal text is escaped', () => {
  const raw = html.match(/<script id="sticker-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const stickers = JSON.parse(raw);
  assert.equal(Object.keys(stickers).length, 32);
  for (const s of Object.values(stickers)) assert.match(s.data, /^data:image\/webp;base64,/);
  assert.equal(J.escape('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
