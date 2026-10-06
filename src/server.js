import express from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TripStore } from './domain/store.js';
import { mountMcp } from './mcp/http.js';
import { ConversationSession, UserError } from './agent/session.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKIE = 'travel_folio_session';
const IDLE_TTL = 12 * 60 * 60 * 1000;
const REMEMBER_TTL = 60 * 24 * 60 * 60 * 1000;
const BRIEFING_GAP = 2 * 60 * 60 * 1000;
export const DEFAULT_DATA_DIR = path.join(HERE, '..', 'data');

export function lanAddresses(interfaces = os.networkInterfaces()) {
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) => (entries || [])
    .filter((entry) => !entry.internal && entry.family === 'IPv4')
    .map((entry) => {
      const privateLan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address);
      const virtual = /(vEthernet|WSL|Tailscale|Docker|VMware|VirtualBox|Bluetooth)/i.test(name);
      const linkLocal = entry.address.startsWith('169.254.');
      return { address: entry.address, rank: (privateLan ? 10 : 0) - (virtual ? 20 : 0) - (linkLocal ? 40 : 0) };
    }));
  return candidates.sort((a, b) => b.rank - a.rank).map((entry) => entry.address);
}
function bearerMatches(value, token) {
  const actual = Buffer.from(value || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function cookieId(req) {
  const value = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[\da-f-]{36}$/.test(value) ? value : null;
}

/** No credentials are loaded and no external request happens until an explicitly enabled action. */
export async function startServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const port = Number(options.port ?? process.env.PORT ?? 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
  const agentMode = options.agentMode ?? process.env.AGENT_MODE ?? 'guided';
  const weatherMode = options.weatherMode ?? process.env.WEATHER_MODE ?? 'demo';
  if (!['guided', 'bedrock'].includes(agentMode)) throw new Error('AGENT_MODE must be guided or bedrock.');
  if (!['demo', 'live'].includes(weatherMode)) throw new Error('WEATHER_MODE must be demo or live.');
  const bedrockModelId = options.bedrockModelId ?? process.env.BEDROCK_MODEL_ID;
  const region = options.region ?? process.env.AWS_REGION;
  const configuredBase = options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL;
  let publicUrl;
  if (configuredBase) {
    publicUrl = new URL(configuredBase);
    if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || !['', '/'].includes(publicUrl.pathname)) throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin, without credentials, path, query or fragment.');
  }
  // With a data directory, each browser's home plan is saved under its random
  // session id and restored on the next visit, even after a server restart.
  const dataDir = options.dataDir !== undefined ? options.dataDir : process.env.DATA_DIR || null;
  const homeFile = (id) => dataDir ? path.join(dataDir, 'homes', `${id}.json`) : null;
  const config = { agentMode, weatherMode, bedrockConfigured: Boolean(bedrockModelId && region), remembers: Boolean(dataDir) };
  const app = express();
  const sessions = new Map();
  const stores = new Map();
  const token = randomBytes(32).toString('hex');
  const addresses = lanAddresses();
  let url;
  let publicBase;
  let actualPort;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const allowed = new Set([`localhost:${actualPort}`, `127.0.0.1:${actualPort}`, `[::1]:${actualPort}`, ...addresses.map((ip) => `${ip}:${actualPort}`), ...(publicUrl ? [publicUrl.host] : [])]);
    if (!allowed.has(req.headers.host?.toLowerCase())) return res.status(403).json({ error: 'Use the local app URL or configured public URL.' });
    if (req.headers.origin && req.headers.origin !== `${req.protocol}://${req.headers.host}` && req.headers.origin !== publicUrl?.origin) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const mcp = mountMcp(app, (req) => {
    const store = stores.get(req.header('x-folio-session'));
    return store ? { store, publicBaseUrl: () => publicBase, weatherMode, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) } : null;
  }, '/mcp', {
    authorize: (req) => bearerMatches(req.headers.authorization, token),
    owner: (req) => req.header('x-folio-session'),
  });
  app.use('/api', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && !req.headers.origin) return res.status(403).json({ error: 'An Origin header is required for this action.' });
    if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON for this action.' });
    let id = cookieId(req);
    let session = id && sessions.get(id);
    if (!session) {
      if (sessions.size >= 100) return res.status(503).json({ error: 'Too many active browser sessions. Try again later.' });
      const returning = Boolean(id && dataDir && fs.existsSync(homeFile(id)));
      if (!returning) id = randomUUID();
      let store = new TripStore({ file: homeFile(id) });
      // A damaged save is left untouched for manual recovery; this browser starts fresh.
      if (store.loadError) { id = randomUUID(); store = new TripStore({ file: homeFile(id) }); }
      stores.set(id, store);
      session = new ConversationSession({ id, url, token, config, bedrockModelId, region, bedrockSend: options.bedrockSend });
      sessions.set(id, session);
      res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: dataDir ? REMEMBER_TTL : IDLE_TTL });
      if (store.getTrip()) {
        try { await session.serialized(() => session.restore()); } catch (error) { return next(error); }
      }
    } else if (session.trip && Date.now() - session.lastUsed > BRIEFING_GAP) session.briefingDue = true;
    session.lastUsed = Date.now();
    req.folio = session;
    next();
  });
  app.get('/api/state', async (req, res) => {
    await req.folio.queue;
    res.json(req.folio.snapshot());
  });
  const mutate = (handler) => async (req, res, next) => {
    try {
      req.folio.limit();
      const result = await req.folio.serialized(() => handler(req.folio, req.body));
      res.json(result);
    } catch (error) { next(error); }
  };
  app.post('/api/action', mutate((session, body) => {
    if (!body || typeof body.action !== 'string') throw new UserError('Choose an action.');
    return session.handleAction(body);
  }));
  app.post('/api/chat', mutate((session, body) => {
    if (typeof body?.message !== 'string' || !body.message.trim() || body.message.length > 2000) throw new UserError('Enter a message between 1 and 2,000 characters.');
    if (body.inputMode !== undefined && !['text', 'voice'].includes(body.inputMode)) throw new UserError('inputMode must be text or voice.');
    if (body.language !== undefined && !['en-US', 'ja-JP'].includes(body.language)) throw new UserError('Choose English or Japanese for voice.');
    if (body.proposalId !== undefined && body.proposalId !== null && (typeof body.proposalId !== 'string' || body.proposalId.length > 80)) throw new UserError('Invalid voice proposal reference.');
    return session.chat(body.message.trim(), { inputMode: body.inputMode, language: body.language, proposalId: body.proposalId });
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  app.use(express.static(path.join(HERE, '..', 'public'), { dotfiles: 'deny', etag: true }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || (err.name === 'ZodError' ? 400 : 500);
    let message = err.name === 'ZodError' ? err.issues.map((issue) => issue.message).join(' ') : err.message;
    if (err.type === 'entity.parse.failed') message = 'The request was not valid JSON.';
    if (err.type === 'entity.too.large') message = 'That request is too large.';
    // Travel tools provide actionable errors, while stack traces are never returned.
    const voice = req.body?.inputMode === 'voice';
    const japanese = req.body?.language === 'ja-JP';
    res.status(status).json({ error: message || 'The request could not be completed.', ...(voice ? {
      voiceReply: japanese ? 'この操作を完了できませんでした。画面の案内を確認して、もう一度お試しください。' : 'I could not complete that request. Please check the message on screen and try again.',
      voiceLanguage: japanese ? 'ja-JP' : 'en-US', voiceProposalId: null, voiceHandoffReady: false,
    } : {}) });
  });
  const server = await new Promise((resolve, reject) => {
    // Express 5 forwards listen errors to this callback. Resolve only after a
    // successful bind; a failed server has address() === null.
    const listening = app.listen(port, host, (error) => error ? reject(error) : resolve(listening));
    listening.once('error', reject);
  });
  actualPort = server.address().port;
  const clientHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host === '::1' ? '[::1]' : host;
  url = `http://${clientHost}:${actualPort}`;
  publicBase = publicUrl?.origin || (['0.0.0.0', '::'].includes(host) && addresses.length ? `http://${addresses[0]}:${actualPort}` : url);
  const prune = setInterval(() => {
    for (const [id, session] of sessions) {
      if (!session.pending && Date.now() - session.lastUsed > IDLE_TTL) {
        sessions.delete(id); stores.delete(id); session.close().catch(() => {});
      }
    }
  }, 60000);
  prune.unref();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(prune);
    await Promise.allSettled([...sessions.values()].map((session) => session.close()));
    await mcp.close();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  };
  return { app, server, url, publicBaseUrl: publicBase, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer({ dataDir: process.env.DATA_DIR || DEFAULT_DATA_DIR }).then((running) => {
    console.log(`Travel Folio is ready at ${running.url}`);
    console.log('Guided conversation and demo weather need no cloud credentials. Home plans are saved in the data folder on this computer.');
    if (running.publicBaseUrl !== running.url) console.log(`Phone handoff base: ${running.publicBaseUrl}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => running.close().then(() => { process.exitCode = 0; }));
  }).catch((error) => {
    console.error(error.code === 'EADDRINUSE'
      ? 'The port is already in use. Close the other Travel Folio window, or use a different PORT.'
      : error.message);
    process.exitCode = 1;
  });
}
