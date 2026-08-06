import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Workspace } from '../core/workspace.js';
import { EDGE_TYPES, ISSUE_STATES, NODE_TYPES } from '../core/schema.js';
import { computeRollup, rollupHash, writeStatus } from '../core/rollup.js';
import { catchUp } from '../core/indexer.js';

const CATCHUP_INTERVAL_MS = 5000;

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const actor = z
  .string()
  .optional()
  .describe('your agent name, for attribution in the activity log (e.g. "claude-code")');

export function registerTools(server: McpServer, ws: Workspace): void {
  let lastCatchUp = Date.now();
  const fresh = () => {
    // The MCP process is long-lived but has no watcher; cheap scan keeps reads
    // honest when files changed underneath us (raw edits, git pull, `serve` writes).
    if (Date.now() - lastCatchUp > CATCHUP_INTERVAL_MS) {
      catchUp(ws.root, ws.db);
      lastCatchUp = Date.now();
    }
  };

  const wrap = <A extends unknown[]>(fn: (...args: A) => unknown) => {
    return (...args: A) => {
      try {
        return fn(...args) as ReturnType<typeof json>;
      } catch (err) {
        return errorResult((err as Error).message);
      }
    };
  };

  server.registerTool(
    'search',
    {
      description:
        'Full-text search across all nodes (projects, issues, docs, artifacts). Returns ranked matches with snippets.',
      inputSchema: {
        query: z.string().describe('search terms'),
        type: z.enum(NODE_TYPES).optional().describe('restrict to one node type'),
        tags: z.array(z.string()).optional().describe('require at least one of these tags'),
        limit: z.number().int().min(1).max(100).optional(),
        include_archived: z.boolean().optional().describe('include archived nodes (excluded by default)'),
      },
    },
    wrap(({ query, type, tags, limit, include_archived }) => {
      fresh();
      return json({ results: ws.search({ query, type, tags, limit, include_archived }) });
    }),
  );

  server.registerTool(
    'get_node',
    {
      description:
        'Fetch one node by id: frontmatter, markdown body, outgoing links, backlinks, and its recent activity.',
      inputSchema: { id: z.string() },
    },
    wrap(({ id }) => {
      fresh();
      const node = ws.loadById(id);
      return json({
        ...node.fm,
        path: node.path,
        body: node.body,
        backlinks: ws.backlinks(id).map((b) => ({ id: b.node.id, title: b.node.title, type: b.node.type, kind: b.kind })),
        activity: ws.activityFor(id, 20),
      });
    }),
  );

  server.registerTool(
    'list',
    {
      description:
        'List node summaries (no bodies) filtered by type, project, state, tags, or recency. Projects include last_active — the most recent activity timestamp across the project and its issues (a project\'s own `updated` does not move when child issues change).',
      inputSchema: {
        type: z.enum(NODE_TYPES).optional(),
        project_id: z.string().optional(),
        state: z.enum(ISSUE_STATES).optional(),
        tags: z.array(z.string()).optional(),
        updated_since: z.string().optional().describe('ISO timestamp'),
        limit: z.number().int().min(1).max(500).optional(),
        order: z.enum(['updated', 'created']).optional(),
        include_archived: z.boolean().optional().describe('include archived nodes (excluded by default)'),
      },
    },
    wrap((opts) => {
      fresh();
      const nodes = ws.list(opts).map((n) =>
        n.type === 'project' ? { ...n, last_active: ws.projectLastActive(n.id) } : n,
      );
      return json({ nodes });
    }),
  );

  server.registerTool(
    'create_node',
    {
      description: [
        'Create a node. Per-type fields:',
        '- project: title + optional body (charter). Gets a slug-derived path.',
        '- issue: requires project_id; body is the description. Starts in `state` (default "triage" — pass state to start elsewhere, e.g. "todo" or "in-progress" if work is already underway).',
        '- doc: body is the content; doc_path places it under docs/ (defaults to a slug of the title).',
        '- artifact: content (text) + ext + mime describe the immutable blob; body is the human-readable caption shown alongside it.',
      ].join('\n'),
      inputSchema: {
        type: z.enum(NODE_TYPES),
        title: z.string(),
        body: z.string().optional().describe('markdown body (issues: description; artifacts: caption)'),
        tags: z.array(z.string()).optional(),
        project_id: z.string().optional().describe('required for issues'),
        state: z.enum(ISSUE_STATES).optional().describe('issues only: initial state, default triage'),
        doc_path: z.string().optional().describe('docs only: path under docs/, extension optional'),
        content: z.string().optional().describe('artifacts only: text content of the blob'),
        ext: z.string().optional().describe('artifacts only: blob file extension, e.g. "csv"'),
        mime: z.string().optional(),
        actor,
      },
    },
    wrap((input) => json(ws.create(input))),
  );

  server.registerTool(
    'update_node',
    {
      description:
        'Patch authored fields (title, body, tags) of a node. Patches to derived or managed fields (state, links, id, timestamps…) are rejected with a pointer to the right tool.',
      inputSchema: {
        id: z.string(),
        patch: z.record(z.unknown()).describe('fields to change, e.g. {"title": "...", "body": "...", "tags": [...]}'),
        actor,
      },
    },
    wrap(({ id, patch, actor: who }) => json(ws.update(id, patch, who))),
  );

  server.registerTool(
    'set_issue_state',
    {
      description: `Transition an issue's state (${ISSUE_STATES.join(' | ')}). The only legal way to change state; appends a state_changed event with your reason. Any transition between distinct states is allowed by design — the states are a vocabulary, not an enforced workflow; your reason string is the audit trail.`,
      inputSchema: {
        id: z.string(),
        state: z.enum(ISSUE_STATES),
        reason: z.string().describe('why — lands in the activity log and derived status'),
        actor,
      },
    },
    wrap(({ id, state, reason, actor: who }) => json({ id, ...ws.setIssueState(id, state, reason, who) })),
  );

  server.registerTool(
    'log_activity',
    {
      description:
        'Append a note event to a node\'s activity log — commits, run results, decisions, observations. This is the exhaust that derived status is computed from.',
      inputSchema: {
        node_id: z.string(),
        text: z.string().describe('what happened'),
        payload: z.record(z.unknown()).optional().describe('optional structured details (commit sha, run id, …)'),
        actor,
      },
    },
    wrap(({ node_id, text, payload, actor: who }) => json({ ok: true, event: ws.logActivity(node_id, text, payload ?? {}, who) })),
  );

  server.registerTool(
    'append_doc',
    {
      description: 'Append markdown to a named "## section" of a doc (section is created at the end if missing).',
      inputSchema: {
        id: z.string().describe('doc node id'),
        section: z.string().describe('section heading text, without the ## prefix'),
        content: z.string(),
        actor,
      },
    },
    wrap(({ id, section, content, actor: who }) => {
      ws.appendDoc(id, section, content, who);
      return json({ ok: true });
    }),
  );

  server.registerTool(
    'write_doc',
    {
      description:
        'Create or FULLY REPLACE a doc at a path under docs/ — the previous body is discarded, so prefer append_doc for incremental additions. Preserves the node id and created date when overwriting. When replacing a doc you read earlier, pass expect_updated (its `updated` timestamp from get_node) so a concurrent change fails loudly instead of being silently clobbered. Refuses paths outside docs/.',
      inputSchema: {
        path: z.string().describe('path under docs/, e.g. "architecture/indexing" (extension optional)'),
        content: z.string().describe('full markdown body'),
        title: z.string().optional(),
        expect_updated: z
          .string()
          .optional()
          .describe("the doc's current `updated` timestamp — write fails if it changed since"),
        actor,
      },
    },
    wrap(({ path: docPath, content, title, expect_updated, actor: who }) =>
      json(ws.writeDoc(docPath, content, title, who, expect_updated)),
    ),
  );

  server.registerTool(
    'link',
    {
      description: `Add a typed edge between two nodes (${EDGE_TYPES.join(' | ')}). "a blocks b" means a is blocking b.`,
      inputSchema: {
        a: z.string().describe('source node id'),
        b: z.string().describe('target node id'),
        type: z.enum(EDGE_TYPES),
        actor,
      },
    },
    wrap(({ a, b, type, actor: who }) => {
      ws.addLink(a, b, type, who);
      return json({ ok: true });
    }),
  );

  server.registerTool(
    'archive_node',
    {
      description:
        'Archive (or unarchive) a node — soft, reversible removal. Archived nodes stay on disk with full history but disappear from list, search, and status rollups. Use this to clean up exploratory or superseded nodes; nothing in wake is ever hard-deleted over MCP.',
      inputSchema: {
        id: z.string(),
        archived: z.boolean().optional().describe('default true; pass false to restore'),
        reason: z.string().describe('why — lands in the activity log'),
        actor,
      },
    },
    wrap(({ id, archived, reason, actor: who }) => json(ws.setArchived(id, archived ?? true, reason, who))),
  );

  server.registerTool(
    'regenerate_status',
    {
      description:
        'Regenerate a project\'s derived status.md. Two-call protocol: call with only project_id to get the computed rollup + rollup_hash; write 2–5 sentences of prose summarizing it, then call again with prose + rollup_hash to commit. If the rollup changed in between, you get the fresh rollup back to retry (or pass force: true).',
      inputSchema: {
        project_id: z.string(),
        prose: z.string().optional().describe('your summary prose for the ## Summary section'),
        rollup_hash: z.string().optional().describe('the hash returned by the first call'),
        force: z.boolean().optional().describe('write even if the rollup changed since the hash was issued'),
        actor,
      },
    },
    wrap(({ project_id, prose, rollup_hash: hash, force, actor: who }) => {
      fresh();
      const rollup = computeRollup(ws, project_id);
      const currentHash = rollupHash(rollup);
      if (!prose) {
        return json({
          rollup,
          rollup_hash: currentHash,
          instructions:
            'Write 2–5 sentences of prose summarizing this rollup for a human reader (what moved, what is stuck, what is next), then call regenerate_status again with { project_id, prose, rollup_hash }.',
        });
      }
      if (hash !== currentHash && !force) {
        return json({
          stale: true,
          rollup,
          rollup_hash: currentHash,
          message: hash
            ? 'The rollup changed since that hash was issued. Re-check your prose against this fresh rollup and retry with the new hash (or pass force: true only if you have already reviewed it).'
            : 'Missing rollup_hash — this is a two-call tool. Review the rollup above, then retry with your prose AND this rollup_hash.',
        });
      }
      const result = writeStatus(ws, project_id, prose, who ?? 'agent');
      ws.logRawEvent(project_id, 'status_regenerated', { hash: result.hash }, who ?? 'agent');
      return json({ ok: true, ...result });
    }),
  );
}
