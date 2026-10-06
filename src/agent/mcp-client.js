import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCP_APP_MIME, UI_EXTENSION } from '../mcp/apps.js';

/** Real HTTP MCP client, shared by guided and Bedrock modes. */
export class TravelTools {
  constructor({ url, token, sessionId, onCall = () => {} }) {
    // The simulator is an MCP Apps host: it can render text/html;profile=mcp-app views.
    this.client = new Client({ name: 'travel-folio-simulator', version: '0.1.0' }, { capabilities: { extensions: { [UI_EXTENSION]: { mimeTypes: [MCP_APP_MIME] } } } });
    this.transport = new StreamableHTTPClientTransport(new URL('/mcp', url), {
      requestInit: { headers: { authorization: `Bearer ${token}`, 'x-folio-session': sessionId } },
      reconnectionOptions: { maxReconnectionDelay: 1000, initialReconnectionDelay: 250, reconnectionDelayGrowFactor: 2, maxRetries: 1 },
    });
    this.onCall = onCall;
    this.ready = null;
    this.uiTools = null;
    this.resources = new Map();
  }
  async connect() {
    this.ready ??= this.client.connect(this.transport);
    await this.ready;
  }
  async list() {
    await this.connect();
    const { tools } = await this.client.listTools();
    this.uiTools = new Map(tools.filter((tool) => tool._meta?.ui?.resourceUri).map((tool) => [tool.name, tool._meta.ui.resourceUri]));
    return tools;
  }
  /** Fetch (once) the HTML of an MCP Apps view declared by a tool. */
  async appResource(uri) {
    if (!this.resources.has(uri)) {
      await this.connect();
      const { contents } = await this.client.readResource({ uri });
      const view = contents.find((item) => item.uri === uri && item.mimeType === MCP_APP_MIME && typeof item.text === 'string');
      if (!view) throw new Error('The trip card could not be loaded.');
      this.resources.set(uri, { html: view.text, csp: view._meta?.ui?.csp || {} });
    }
    return this.resources.get(uri);
  }
  async call(name, args = {}) {
    await this.connect();
    const started = Date.now();
    try {
      const response = await this.client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
      const text = response.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || '';
      if (response.isError) {
        const error = new Error(text || `${name} failed.`);
        error.status = 400;
        throw error;
      }
      this.onCall({ tool: name, ok: true, durationMs: Date.now() - started });
      if (!this.uiTools) await this.list();
      const resourceUri = this.uiTools.get(name);
      const ui = resourceUri ? { resourceUri, tool: name, arguments: args, result: { content: response.content, structuredContent: response.structuredContent } } : null;
      return { data: response.structuredContent || {}, text: text.split('\n\n')[0], ui };
    } catch (error) {
      this.onCall({ tool: name, ok: false, durationMs: Date.now() - started });
      throw error;
    }
  }
  async close() {
    if (this.ready) {
      try { await this.transport.terminateSession(); } catch { /* shutdown or expired transport */ }
    }
    await this.client.close();
  }
}
