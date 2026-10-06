import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createTravelFolioServer } from './server.js';

/**
 * Mount the MCP endpoint (Streamable HTTP transport, stateful sessions) at `path`.
 * Each client session gets its own McpServer instance; all share one TripStore.
 */
export function mountMcp(app, deps, path = '/mcp', { authorize = () => true, owner = () => 'local' } = {}) {
  const sessions = new Map(); // sessionId -> { transport, server }

  app.all(path, (req, res, next) => {
    if (!authorize(req)) return res.status(401).json({ error: 'This MCP endpoint requires the application session credential.' });
    next();
  });

  app.post(path, async (req, res) => {
    try {
      const sid = req.header('mcp-session-id');
      let entry = sid ? sessions.get(sid) : null;
      if (entry && entry.owner !== owner(req)) return res.status(404).json({ error: 'Unknown session.' });
      if (!entry) {
        if (sid || !isInitializeRequest(req.body)) {
          res.status(sid ? 404 : 400).json({ jsonrpc: '2.0', error: { code: -32000, message: sid ? 'Unknown session. Re-initialize.' : 'Send an initialize request first.' }, id: null });
          return;
        }
        if (sessions.size >= 100) return res.status(503).json({ error: 'Too many MCP sessions.' });
        const resolved = typeof deps === 'function' ? deps(req) : deps;
        if (!resolved) return res.status(401).json({ error: 'Unknown application session.' });
        const server = createTravelFolioServer(resolved);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => sessions.set(id, { transport, server, owner: owner(req) }),
        });
        await server.connect(transport);
        const previousClose = transport.onclose;
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
          previousClose?.();
        };
        entry = { transport, server, owner: owner(req) };
      }
      await entry.transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: err?.message || 'Internal error' }, id: null });
    }
  });

  const bySession = async (req, res) => {
    const entry = sessions.get(req.header('mcp-session-id') || '');
    if (!entry || entry.owner !== owner(req)) { res.status(404).send('Unknown session'); return; }
    try { await entry.transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' }); }
  };
  app.get(path, bySession);    // server -> client notification stream
  app.delete(path, bySession); // session termination

  return { sessions, async close() {
    await Promise.allSettled([...sessions.values()].map(({ server }) => server.close()));
    sessions.clear();
  } };
}
