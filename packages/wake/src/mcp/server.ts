import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Workspace } from '../core/workspace.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

export function buildMcpServer(ws: Workspace): McpServer {
  const server = new McpServer({ name: 'wake', version: '0.1.0' });
  registerTools(server, ws);
  registerResources(server, ws);
  return server;
}

export async function runMcpServer(wsRoot: string): Promise<void> {
  const ws = Workspace.open(wsRoot);
  const server = buildMcpServer(ws);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport owns the lifecycle from here; exit when the client hangs up
  process.stdin.on('close', () => {
    ws.close();
    process.exit(0);
  });
}
