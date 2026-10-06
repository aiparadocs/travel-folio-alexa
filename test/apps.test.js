import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTravelFolioServer } from '../src/mcp/server.js';
import { TripStore } from '../src/domain/store.js';
import { MCP_APP_MIME, TRIP_CARD_HTML, TRIP_CARD_URI } from '../src/mcp/apps.js';
import { startServer } from '../src/server.js';

const UI_TOOLS = ['preview_trip', 'create_trip', 'get_itinerary', 'check_weather', 'propose_change', 'apply_change', 'undo_last_change'];

async function mcpSession(t) {
  const server = createTravelFolioServer({ store: new TripStore(), publicBaseUrl: () => 'http://127.0.0.1:3000', weatherMode: 'demo' });
  const client = new Client({ name: 'apps-tests', version: '1.0.0' }, { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [MCP_APP_MIME] } } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test('MCP Apps: trip tools link a versioned ui:// view that is listed and readable', async (t) => {
  const client = await mcpSession(t);
  const { tools } = await client.listTools();
  for (const name of UI_TOOLS) assert.equal(tools.find((tool) => tool.name === name)?._meta?.ui?.resourceUri, TRIP_CARD_URI, name);
  assert.equal(tools.find((tool) => tool.name === 'send_to_phone')._meta?.ui, undefined, 'the QR tool keeps its own host dialog');
  assert.match(TRIP_CARD_URI, /^ui:\/\/travel-folio\/trip-card-[0-9a-f]{10}\.html$/);
  const listed = (await client.listResources()).resources.find((resource) => resource.uri === TRIP_CARD_URI);
  assert.equal(listed.mimeType, MCP_APP_MIME);
  const { contents } = await client.readResource({ uri: TRIP_CARD_URI });
  assert.equal(contents[0].mimeType, MCP_APP_MIME);
  assert.equal(contents[0].text, TRIP_CARD_HTML);
  assert.deepEqual(contents[0]._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
});

test('MCP Apps view is one self-contained bundle with no external requests', () => {
  assert.doesNotMatch(TRIP_CARD_HTML, /<(script|link|img)[^>]+(src|href)=/i, 'no external scripts, styles or images');
  assert.doesNotMatch(TRIP_CARD_HTML, /url\((?!data:)/, 'fonts are inlined as data URLs');
  assert.doesNotMatch(TRIP_CARD_HTML, /\bfetch\(|XMLHttpRequest|localStorage|document\.cookie/);
  assert.match(TRIP_CARD_HTML, /font-family:'Caveat'/);
  const script = TRIP_CARD_HTML.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
});

test('MCP Apps view speaks the ui/initialize handshake and renders tool results', async () => {
  // Run the real view script against a tiny DOM stand-in and a fake host.
  const posted = [];
  const listeners = [];
  const make = (tag) => {
    const node = { tag, children: [], style: {}, dataset: {}, attributes: {}, textContent: '', className: '', classList: { toggle() {} },
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      setAttribute(name, value) { this.attributes[name] = value; }, addEventListener() {},
      getBoundingClientRect: () => ({ width: 768, height: 480 }) };
    Object.defineProperty(node, 'firstChild', { get() { return this.children[0]; } });
    return node;
  };
  const root = make('div');
  const documentElement = make('html');
  const parent = { postMessage: (message) => posted.push(message) };
  const context = {
    window: { parent, addEventListener: (type, fn) => listeners.push(fn) },
    document: { getElementById: () => root, createElement: make, documentElement },
    ResizeObserver: class { observe() {} },
    Intl, Date, Math, String, Number, Set, Map, Promise, JSON, Array, Object, setTimeout: () => 0, clearTimeout: () => {},
  };
  vm.runInNewContext(TRIP_CARD_HTML.match(/<script>([\s\S]*)<\/script>/)[1], context);
  const init = posted.find((message) => message.method === 'ui/initialize');
  assert.equal(init.params.protocolVersion, '2026-01-26');
  assert.equal(init.params.appInfo.name, 'travel-folio-trip-card');
  const deliver = (data) => listeners.forEach((fn) => fn({ source: parent, data }));
  deliver({ jsonrpc: '2.0', id: init.id, result: { hostContext: { theme: 'dark', containerDimensions: { width: 1280, height: 800 } } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(posted.some((message) => message.method === 'ui/notifications/initialized'));
  assert.equal(documentElement.style.zoom, '1.667', 'Alexa+ root scale for an Echo Show 8 width');
  assert.equal(documentElement.dataset.theme, 'dark');
  const text = (node) => [node.textContent, ...node.children.map(text)].join(' ');
  deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { proposal: { summary: 'Swap A for B.', diff: [{ op: 'replaced', day: 1, before: { time: '10:00', title: 'A' }, after: { time: '10:00', title: 'B' } }] } } } });
  assert.match(text(root), /A change of plan/);
  assert.match(text(root), /Nothing changes until you confirm/);
  deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { day: 1, date: '2026-10-07', source: 'demo', atRisk: [{ stopId: 's1', title: 'A' }], rainyWindow: { from: '10:00', to: '17:00' }, stops: [{ stopId: 's1', time: '10:00', title: 'A', kind: 'walk', minutes: 60 }], hourly: [] } } });
  assert.match(text(root), /Rain likely 10:00–17:00/);
  assert.match(text(root), /Sample weather/);
  deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { preview: { title: '2 days in Kyoto', city: 'kyoto', days: [{ day: 1, stops: [{ stopId: 'x', time: '10:00', title: 'Fushimi Inari Taisha', kind: 'walk', minutes: 120 }] }, { day: 2, stops: [] }] } } } });
  assert.match(text(root), /Alexa suggests · 2-day trip/);
  assert.match(text(root), /Nothing is saved until you confirm/);
  deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { memories: { title: '2 days in Kyoto', items: [{ day: 2, time: '14:29', title: 'Kinkaku-ji', caption: 'Gold on a blue afternoon.', photo: 'data:image/jpeg;base64,AAAA', stickers: [] }, { day: 2, title: 'Genko-an', caption: 'Round window.', photo: null, stickers: [] }] } } } });
  assert.match(text(root), /OUR TRIP MEMORIES/);
  assert.match(text(root), /Kinkaku-ji/);
  assert.match(text(root), /Gold on a blue afternoon\./);
  assert.match(text(root), /1 \/ 2/);
  const other = { postMessage() {} };
  listeners.forEach((fn) => fn({ source: other, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { trip: { title: 'Injected', days: [] } } } } }));
  assert.doesNotMatch(text(root), /Injected/, 'messages not from the host are ignored');
});

test('HTTP host: the simulator keeps the latest card and serves it with a cross-origin sandbox', async (t) => {
  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const port = new URL(running.url).port;
  const first = await fetch(`${running.url}/api/state`);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.equal((await first.json()).app, null);
  const post = async (body) => (await fetch(`${running.url}/api/action`, { method: 'POST', headers: { cookie, origin: running.url, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const prepared = await post({ action: 'create', city: 'kyoto', days: 2 });
  await post({ action: 'confirm', proposalId: prepared.proposal.proposalId });
  const weather = await post({ action: 'weather', day: 1 });
  assert.equal(weather.app.tool, 'check_weather');
  assert.equal(weather.app.resourceUri, TRIP_CARD_URI);
  assert.equal(weather.app.result, undefined, 'state polling stays small: the card payload is fetched separately');
  const call = await (await fetch(`${running.url}/api/app-call`, { headers: { cookie } })).json();
  assert.equal(call.id, weather.app.id);
  assert.ok(call.result.structuredContent.stops.length);
  const view = await fetch(`${running.url}/api/app-view?uri=${encodeURIComponent(TRIP_CARD_URI)}`, { headers: { cookie } });
  assert.equal(view.status, 200);
  assert.equal((await view.json()).html, TRIP_CARD_HTML);
  assert.equal((await fetch(`${running.url}/api/app-view?uri=${encodeURIComponent('https://evil.invalid/x')}`, { headers: { cookie } })).status, 404);
  const sandbox = await fetch(`http://localhost:${port}/mcp-app/sandbox.html`);
  assert.equal(sandbox.status, 200);
  assert.equal(sandbox.headers.get('x-frame-options'), null);
  assert.equal(sandbox.headers.get('content-security-policy'), `frame-ancestors http://localhost:${port} http://127.0.0.1:${port}`);
  assert.equal((await fetch(`${running.url}/show.html`)).headers.get('x-frame-options'), 'DENY');
});

test('preview_trip shows a new trip as a card without saving anything', async (t) => {
  const store = new TripStore();
  const server = createTravelFolioServer({ store, publicBaseUrl: () => 'http://127.0.0.1:3000', weatherMode: 'demo' });
  const client = new Client({ name: 'preview-tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const tool = (await client.listTools()).tools.find((item) => item.name === 'preview_trip');
  assert.equal(tool.annotations.readOnlyHint, true);
  const preview = await client.callTool({ name: 'preview_trip', arguments: { city: 'kyoto', days: 2, pace: 'relaxed', interests: ['culture', 'views'], startDate: '2026-10-07' } });
  assert.equal(preview.structuredContent.preview.title, '2 days in Kyoto');
  assert.ok(preview.structuredContent.preview.days[1].stops.some((stop) => stop.title === 'Kinkaku-ji'));
  assert.equal(store.getTrip(), null, 'nothing is saved by a preview');

  const running = await startServer({ port: 0, agentMode: 'guided', weatherMode: 'demo' });
  t.after(() => running.close());
  const first = await fetch(`${running.url}/api/state`);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const prepared = await (await fetch(`${running.url}/api/action`, { method: 'POST', headers: { cookie, origin: running.url, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', city: 'kyoto', days: 2 }) })).json();
  assert.equal(prepared.trip, null);
  assert.equal(prepared.proposal.kind, 'create');
  assert.equal(prepared.app.tool, 'preview_trip', 'the screen shows the pending trip before it is confirmed');
  const call = await (await fetch(`${running.url}/api/app-call`, { headers: { cookie } })).json();
  assert.equal(call.arguments.city, 'kyoto');
});
