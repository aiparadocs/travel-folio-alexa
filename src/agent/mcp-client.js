import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Real HTTP MCP client, shared by guided and Bedrock modes. */
export class TravelTools {
  constructor({ url, token, sessionId, onCall = () => {} }) {
    this.client = new Client({ name: 'travel-folio-simulator', version: '0.1.0' });
    this.transport = new StreamableHTTPClientTransport(new URL('/mcp', url), {
      requestInit: { headers: { authorization: `Bearer ${token}`, 'x-folio-session': sessionId } },
      reconnectionOptions: { maxReconnectionDelay: 1000, initialReconnectionDelay: 250, reconnectionDelayGrowFactor: 2, maxRetries: 1 },
    });
    this.onCall = onCall;
    this.ready = null;
  }
  async connect() {
    this.ready ??= this.client.connect(this.transport);
    await this.ready;
  }
  async list() {
    await this.connect();
    return (await this.client.listTools()).tools;
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
      return { data: response.structuredContent || {}, text: text.split('\n\n')[0] };
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
