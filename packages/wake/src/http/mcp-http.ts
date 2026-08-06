import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Hub } from '../core/spaces.js';
import { buildMcpServer } from '../mcp/server.js';

/**
 * Streamable HTTP MCP endpoint state. One McpServer + transport per client
 * session, all sharing one Hub (better-sqlite3 is synchronous, so concurrent
 * sessions serialize naturally on the event loop). The hub handed in decides
 * which spaces these sessions can reach.
 */
export class McpHttpEndpoint {
  private transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(private hub: Hub) {}

  async handle(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? this.transports.get(sessionId) : undefined;

    if (!transport) {
      if (req.method !== 'POST' || sessionId) {
        res.writeHead(sessionId ? 404 : 405).end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'no such session — initialize first' }, id: null }),
        );
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          this.transports.set(sid, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) this.transports.delete(transport!.sessionId);
      };
      const server = buildMcpServer(this.hub);
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, body);
  }
}
