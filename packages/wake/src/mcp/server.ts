import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Hub } from '../core/spaces.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

export function buildMcpServer(hub: Hub): McpServer {
  const server = new McpServer({ name: 'wake', version: '0.1.0' });
  registerTools(server, hub);
  registerResources(server, hub);
  return server;
}

export async function runMcpServer(hub: Hub): Promise<void> {
  const server = buildMcpServer(hub);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport owns the lifecycle from here; exit when the client hangs up
  process.stdin.on('close', () => {
    hub.closeAll();
    process.exit(0);
  });
}
