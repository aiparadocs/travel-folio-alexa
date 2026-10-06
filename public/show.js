'use strict';

// A minimal MCP Apps *host* (spec 2026-01-26) that renders Travel Folio's
// trip card the way an Alexa+ screen device would. The view runs inside a
// sandbox proxy served from a different origin (localhost <-> 127.0.0.1).
(() => {
  const $ = (id) => document.getElementById(id);
  const CARD_WIDTH = 992; // 768x480 design canvas x 1.29: fits between status bar and caption strip
  const POLL_MS = 1500;
  let shownId = null;
  let lastMessage = '';
  let captionTimer = 0;
  let active = null;

  function fit() {
    const device = $('device');
    const scale = (device.clientWidth - 48) / 1280;
    $('screen').style.transform = `scale(${scale})`;
    device.style.height = `${800 * scale + 48}px`;
  }
  function tick() {
    const now = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date());
    const hour = new Date().getHours();
    $('clock').textContent = now;
    $('idle-time').textContent = now;
    $('idle-greeting').textContent = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }
  function caption(text) {
    if (!text || text === lastMessage) return;
    lastMessage = text;
    $('caption-text').textContent = text;
    $('caption').hidden = false;
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => { $('caption').hidden = true; }, 6000);
  }

  function sandboxOrigin() {
    const other = location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    return `${location.protocol}//${other}:${location.port}`;
  }

  async function mount(app) {
    const response = await fetch(`/api/app-view?uri=${encodeURIComponent(app.resourceUri)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('The card could not be loaded.');
    const { html, csp } = await response.json();
    const origin = sandboxOrigin();
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('title', 'Travel Folio card');
    frame.style.width = `${CARD_WIDTH}px`;
    frame.style.height = `${480 * (CARD_WIDTH / 768)}px`;
    frame.src = `${origin}/mcp-app/sandbox.html?host=${encodeURIComponent(location.origin)}`;
    const session = { frame, origin, app, initialized: false };
    const post = (message) => frame.contentWindow?.postMessage({ jsonrpc: '2.0', ...message }, origin);
    session.onMessage = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (message.method === 'ui/notifications/sandbox-proxy-ready') return post({ method: 'ui/notifications/sandbox-resource-ready', params: { html, csp } });
      if (message.method === 'ui/initialize' && message.id != null) {
        return post({ id: message.id, result: {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'travel-folio-echo-show-simulator', version: '0.2.0' },
          hostCapabilities: {},
          hostContext: {
            toolInfo: { tool: { name: app.tool } },
            theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'],
            containerDimensions: { width: CARD_WIDTH, height: 480 * (CARD_WIDTH / 768) },
            locale: 'en-US', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, platform: 'web',
            deviceCapabilities: { touch: true, hover: false }, safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        } });
      }
      if (message.method === 'ui/notifications/initialized') {
        session.initialized = true;
        post({ method: 'ui/notifications/tool-input', params: { arguments: app.arguments || {} } });
        post({ method: 'ui/notifications/tool-result', params: app.result });
        swap(session);
        return;
      }
      // This simulator does not let views call tools: changes need the human's confirmation in Travel Folio.
      if (message.id != null && message.method) post({ id: message.id, error: { code: -32601, message: 'Not supported by this host.' } });
    };
    window.addEventListener('message', session.onMessage);
    frame.style.visibility = 'hidden';
    frame.style.position = 'absolute';
    $('view').append(frame);
    setTimeout(() => { if (!session.initialized) { teardown(session); } }, 8000);
  }
  function teardown(session) {
    window.removeEventListener('message', session.onMessage);
    session.frame.remove();
  }
  function swap(session) {
    if (active && active !== session) teardown(active);
    active = session;
    session.frame.style.visibility = 'visible';
    session.frame.style.position = 'static';
    $('idle').hidden = true;
    $('view').hidden = false;
  }

  async function poll() {
    try {
      const response = await fetch('/api/state', { credentials: 'same-origin' });
      if (response.ok) {
        const state = await response.json();
        const assistant = [...(state.messages || [])].reverse().find((entry) => entry.role === 'assistant');
        if (state.app && state.app.id !== shownId) {
          shownId = state.app.id;
          await mount(state.app).catch(() => {});
        }
        if (assistant && state.messages.length > 1) caption(assistant.text);
      }
    } catch { /* The planner may be restarting; keep the last card. */ }
    setTimeout(poll, POLL_MS);
  }

  window.addEventListener('resize', fit);
  fit();
  tick();
  setInterval(tick, 10000);
  poll();
})();
