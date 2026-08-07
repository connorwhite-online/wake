import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Hub } from '../core/spaces.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

/**
 * Sent to the client at connect time and surfaced to the model, so an agent
 * that has never seen wake knows what it is and when to reach for it before
 * it has a question. Tool descriptions explain each call; this explains the
 * habit.
 */
export const WAKE_INSTRUCTIONS = `wake is the workspace where this person's projects, issues, docs and decisions
live. You are expected to WRITE to it as you work, not only read from it — the
record is the point, and an unlogged hour is an invisible hour.

The model: a person belongs to SPACES (boundaries of visibility, e.g. work vs a
side project). A space holds many PROJECTS; a project holds ISSUES. Docs and
artifacts live at space level and attach to a project with a "documents" edge,
so knowledge outlives the project that prompted it.

Getting oriented:
- Call list_spaces first. Each space lists the repos whose work belongs in it —
  if you are working in a repo, match its remote (e.g. "github.com/you/api")
  against those to pick the right space. Ask the human if nothing matches.
- search before starting substantial work: the decision, the doc, or a
  duplicate issue may already be recorded.

The rhythm while you work:
1. File multi-step work as an issue (create_node type=issue) BEFORE starting,
   so the trail exists while you work rather than being reconstructed after.
2. set_issue_state as reality changes, with a reason worth reading later.
3. log_activity for commits, findings, dead ends and decisions. Derived status
   is computed from this exhaust.
4. write_doc for durable knowledge — architecture, decisions, conventions.
   A doc someone will search for later beats a comment nobody finds.
5. regenerate_status when a project's picture changed. It is a two-call
   handshake: fetch the rollup, then send 2-4 sentences saying what moved and
   what is stuck. Do not restate counts — the reading UI renders those as
   charts beside your prose.

What you must not do: hand-edit derived state. Issue state changes only through
set_issue_state, status.md only through regenerate_status, archived only through
archive_node. update_node rejects those patches and tells you which tool to use.
Nothing is ever hard-deleted; archive_node is the reversible cleanup verb, so
exploratory nodes are cheap.

Read the wake://conventions resource for the full contract, and wake://spaces
for the current shape of everything you can reach.`;

export function buildMcpServer(hub: Hub): McpServer {
  const server = new McpServer(
    { name: 'wake', version: '0.1.0' },
    { instructions: WAKE_INSTRUCTIONS },
  );
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
