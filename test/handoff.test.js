import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTrip } from '../src/domain/planner.js';
import { compress, decompress, handoff, packForPhone, phoneLink } from '../src/handoff.js';

function actualPhoneTransfer() {
  const html = fs.readFileSync(new URL('../public/phone/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const context = vm.createContext({ TextEncoder, TextDecoder });
  for (const marker of ['Journey Light: dependency-free data model', 'A plan travels in a URL fragment']) {
    const script = scripts.find((code) => code.includes(marker));
    assert.ok(script, `Phone script exists: ${marker}`);
    vm.runInContext(script, context);
  }
  return context.JourneyTransfer;
}

test('every trip length imports into the actual phone data model with schedule and notes intact', () => {
  const phone = actualPhoneTransfer();
  for (const city of ['kyoto', 'seattle']) for (const days of [1, 2, 3, 4]) {
    const trip = createTrip({ city, days, pace: 'packed', interests: ['coffee', 'culture'], startDate: '2026-10-05' });
    trip.stops[0].locked = true;
    trip.stops[0].done = true;
    trip.stops[0].caption = 'Private memory';
    trip.stops[0].photo = 'private-photo-data';
    const encoded = new URL(phoneLink(trip, 'https://example.com')).hash.slice('#trip='.length);
    const imported = phone.decode(encoded);
    assert.equal(imported.title, trip.title);
    assert.equal(imported.place, trip.cityName);
    assert.equal(imported.start, trip.startDate);
    assert.equal(imported.days, days);
    assert.equal(imported.stops.length, trip.stops.length);
    for (let i = 0; i < trip.stops.length; i++) {
      const incoming = imported.stops[i], original = trip.stops[i];
      assert.equal(incoming.title, original.title);
      assert.equal(incoming.time, original.time);
      assert.equal(incoming.day, original.day);
      assert.equal(incoming.kind, original.kind);
      assert.equal(incoming.planNote, original.note);
      assert.equal(incoming.locked, original.locked);
      assert.equal(incoming.done, false);
      assert.equal(incoming.photo, null);
      assert.equal(incoming.caption, '');
    }
    assert.deepEqual(JSON.parse(decompress(encoded)), packForPhone(trip));
  }
});

test('long four-day plans produce a full QR without discarding notes', async () => {
  for (const city of ['kyoto', 'seattle']) {
    const trip = createTrip({ city, days: 4, pace: 'packed', interests: ['coffee', 'culture'], startDate: '2026-10-05' });
    const result = await handoff(trip, 'http://192.168.1.123:3000');
    assert.match(result.qrSvg, /^<svg/);
    assert.equal(result.reachableFromPhone, true);
    assert.deepEqual(JSON.parse(decompress(new URL(result.url).hash.slice(6))), packForPhone(trip));
  }
});

test('with a short-link resolver the QR stays small enough for a phone camera', async () => {
  // A whole two-day plan in the QR needs version 25 (117 modules): too dense to scan on screen.
  const trip = createTrip({ city: 'kyoto', days: 4, pace: 'packed', interests: ['coffee', 'culture'], startDate: '2026-10-05' });
  const seen = [];
  const result = await handoff(trip, 'http://192.168.1.123:3000', { homeToken: 'a'.repeat(32), shorten: (url) => { seen.push(url); return 'abcDEF123_-x'; } });
  assert.equal(result.qrUrl, 'http://192.168.1.123:3000/t/abcDEF123_-x');
  assert.deepEqual(seen, [result.url], 'the short link resolves to the full plan link');
  assert.match(result.qrSvg, /viewBox="0 0 37 37"/, 'version 3: 29 modules plus the quiet zone');
  assert.deepEqual(JSON.parse(decompress(new URL(result.url).hash.slice(6))), packForPhone(trip));
  const plain = await handoff(trip, 'http://192.168.1.123:3000');
  assert.equal(plain.qrUrl, plain.url, 'without a resolver the QR carries the whole plan');
});

test('loopback and bind addresses are not advertised as phone-reachable', async () => {
  const trip = createTrip({ city: 'kyoto', days: 1 });
  for (const base of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'http://0.0.0.0:3000', 'http://[::]:3000']) {
    assert.equal((await handoff(trip, base)).reachableFromPhone, false);
  }
});

test('transfer handles Unicode and rejects damaged or unbounded input', () => {
  const text = JSON.stringify(['京都の旅 ☕', '雨でも楽しい']);
  assert.equal(decompress(compress(text)), text);
  for (const code of ['', 'A', '!!', 'AA'.repeat(6001)]) assert.throws(() => decompress(code), /invalid|too large/);
  assert.throws(() => phoneLink(createTrip({ city: 'kyoto' }), 'javascript:alert(1)'));
});
