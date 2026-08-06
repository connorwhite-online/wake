import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Workspace } from '../core/workspace.js';
import type { Hub } from '../core/spaces.js';
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

const spaceParam = z
  .string()
  .optional()
  .describe('space slug (see list_spaces); optional when you can only reach one space');

export function registerTools(server: McpServer, hub: Hub): void {
  let lastCatchUp = 0;
  const fresh = () => {
    // no watcher in a bare MCP process; cheap scan keeps reads honest when
    // files changed underneath us (raw edits, git pull, another writer)
    if (Date.now() - lastCatchUp > CATCHUP_INTERVAL_MS) {
      hub.refresh();
      for (const { ws } of hub.all()) catchUp(ws.root, ws.db);
      lastCatchUp = Date.now();
    }
  };

  /** The space to write into: explicit, or the only one, or the configured default. */
  const writeSpace = (slug?: string): Workspace => {
    if (slug) return hub.workspace(slug);
    const spaces = hub.spaces();
    if (spaces.length === 1) return hub.workspace(spaces[0].slug);
    const fallback = hub.defaultSlug();
    if (process.env.WAKE_DEFAULT_SPACE && fallback) return hub.workspace(fallback);
    throw new Error(
      `you can reach ${spaces.length} spaces (${spaces.map((s) => s.slug).join(', ')}) — pass 'space' to say which one this belongs in`,
    );
  };

  /** The space holding a node — ids are globally unique, so no need to ask. */
  const spaceOfNode = (id: string): Workspace => {
    const found = hub.locate(id);
    if (!found) throw new Error(`no node ${id} in any space you can reach`);
    return found.ws;
  };

  /** Spaces to read from: one if named, otherwise every visible one. */
  const readSpaces = (slug?: string): Workspace[] =>
    slug ? [hub.workspace(slug)] : hub.all().map(({ ws }) => ws);

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
    'list_spaces',
    {
      description:
        'List the spaces you can reach. A space is a visibility boundary holding many projects (plus their issues, docs and artifacts) — start here to orient, then pass a space slug to the other tools when creating things.',
      inputSchema: {},
    },
    wrap(() => {
      fresh();
      return json({
        spaces: hub.spaces().map((info) => {
          const ws = hub.workspace(info.slug);
          const projects = ws.list({ type: 'project' });
          return {
            slug: info.slug,
            name: info.name,
            description: info.description,
            projects: projects.map((p) => ({ id: p.id, slug: p.slug, title: p.title })),
          };
        }),
      });
    }),
  );

  server.registerTool(
    'search',
    {
      description:
        'Full-text search across nodes (projects, issues, docs, artifacts). Searches every space you can reach unless you name one. Returns ranked matches with snippets.',
      inputSchema: {
        query: z.string().describe('search terms'),
        space: spaceParam,
        type: z.enum(NODE_TYPES).optional().describe('restrict to one node type'),
        tags: z.array(z.string()).optional().describe('require at least one of these tags'),
        limit: z.number().int().min(1).max(100).optional(),
        include_archived: z.boolean().optional().describe('include archived nodes (excluded by default)'),
      },
    },
    wrap(({ query, space, type, tags, limit, include_archived }) => {
      fresh();
      const results = readSpaces(space)
        .flatMap((ws) =>
          ws
            .search({ query, type, tags, limit, include_archived })
            .map((r) => ({ ...r, space: ws.slug })),
        )
        .sort((a, b) => a.score - b.score)
        .slice(0, limit ?? 20);
      return json({ results });
    }),
  );

  server.registerTool(
    'get_node',
    {
      description:
        'Fetch one node by id: frontmatter, markdown body, outgoing links, backlinks, and recent activity. Finds the node in whichever space holds it.',
      inputSchema: { id: z.string() },
    },
    wrap(({ id }) => {
      fresh();
      const ws = spaceOfNode(id);
      const node = ws.loadById(id);
      return json({
        ...node.fm,
        space: ws.slug,
        path: node.path,
        body: node.body,
        backlinks: ws
          .backlinks(id)
          .map((b) => ({ id: b.node.id, title: b.node.title, type: b.node.type, kind: b.kind })),
        activity: ws.activityFor(id, 20),
      });
    }),
  );

  server.registerTool(
    'list',
    {
      description:
        "List node summaries (no bodies) filtered by type, project, state, tags, or recency. Spans every space you can reach unless you name one. Projects include last_active — the most recent activity across the project and its issues (a project's own `updated` does not move when child issues change).",
      inputSchema: {
        space: spaceParam,
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
    wrap(({ space, ...opts }) => {
      fresh();
      const nodes = readSpaces(space).flatMap((ws) =>
        ws.list(opts).map((n) => ({
          ...n,
          space: ws.slug,
          ...(n.type === 'project' ? { last_active: ws.projectLastActive(n.id) } : {}),
        })),
      );
      return json({ nodes });
    }),
  );

  server.registerTool(
    'create_node',
    {
      description: [
        'Create a node inside a space. Per-type fields:',
        '- project: title + optional body (charter). A space holds many projects.',
        '- issue: requires project_id; body is the description. Starts in `state` (default "triage" — pass state to start elsewhere, e.g. "in-progress" if work is already underway).',
        '- doc: body is the content; doc_path places it under docs/. Docs live at space level and can be attached to a project with the `documents` edge.',
        '- artifact: content (text) + ext + mime describe the immutable blob; body is the human-readable caption.',
      ].join('\n'),
      inputSchema: {
        type: z.enum(NODE_TYPES),
        title: z.string(),
        space: spaceParam,
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
    wrap(({ space, project_id, ...input }) => {
      // an issue belongs wherever its project lives — no need to name the space twice
      const ws = project_id ? spaceOfNode(project_id) : writeSpace(space);
      return json({ ...ws.create({ ...input, project_id }), space: ws.slug });
    }),
  );

  server.registerTool(
    'update_node',
    {
      description:
        'Patch authored fields (title, body, tags) of a node. Patches to derived or managed fields (state, links, archived, id, timestamps…) are rejected with a pointer to the right tool.',
      inputSchema: {
        id: z.string(),
        patch: z.record(z.unknown()).describe('fields to change, e.g. {"title": "...", "body": "...", "tags": [...]}'),
        actor,
      },
    },
    wrap(({ id, patch, actor: who }) => json(spaceOfNode(id).update(id, patch, who))),
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
    wrap(({ id, state, reason, actor: who }) =>
      json({ id, ...spaceOfNode(id).setIssueState(id, state, reason, who) }),
    ),
  );

  server.registerTool(
    'log_activity',
    {
      description:
        "Append a note event to a node's activity log — commits, run results, decisions, observations. This is the exhaust that derived status is computed from.",
      inputSchema: {
        node_id: z.string(),
        text: z.string().describe('what happened'),
        payload: z.record(z.unknown()).optional().describe('optional structured details (commit sha, run id, …)'),
        actor,
      },
    },
    wrap(({ node_id, text, payload, actor: who }) =>
      json({ ok: true, event: spaceOfNode(node_id).logActivity(node_id, text, payload ?? {}, who) }),
    ),
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
      spaceOfNode(id).appendDoc(id, section, content, who);
      return json({ ok: true });
    }),
  );

  server.registerTool(
    'write_doc',
    {
      description:
        'Create or FULLY REPLACE a doc at a path under docs/ in a space — the previous body is discarded, so prefer append_doc for incremental additions. Preserves the node id and created date when overwriting. When replacing a doc you read earlier, pass expect_updated (its `updated` timestamp from get_node) so a concurrent change fails loudly instead of being silently clobbered.',
      inputSchema: {
        path: z.string().describe('path under docs/, e.g. "architecture/indexing" (extension optional)'),
        content: z.string().describe('full markdown body'),
        space: spaceParam,
        title: z.string().optional(),
        expect_updated: z
          .string()
          .optional()
          .describe("the doc's current `updated` timestamp — write fails if it changed since"),
        actor,
      },
    },
    wrap(({ path: docPath, content, space, title, expect_updated, actor: who }) => {
      const ws = writeSpace(space);
      return json({ ...ws.writeDoc(docPath, content, title, who, expect_updated), space: ws.slug });
    }),
  );

  server.registerTool(
    'link',
    {
      description: `Add a typed edge between two nodes in the same space (${EDGE_TYPES.join(' | ')}). "a blocks b" means a is blocking b; use "documents" to attach a doc to a project.`,
      inputSchema: {
        a: z.string().describe('source node id'),
        b: z.string().describe('target node id'),
        type: z.enum(EDGE_TYPES),
        actor,
      },
    },
    wrap(({ a, b, type, actor: who }) => {
      const ws = spaceOfNode(a);
      if (!ws.nodeRow(b)) {
        throw new Error(`${b} is not in the same space as ${a} — links stay inside one space`);
      }
      ws.addLink(a, b, type, who);
      return json({ ok: true, space: ws.slug });
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
    wrap(({ id, archived, reason, actor: who }) =>
      json(spaceOfNode(id).setArchived(id, archived ?? true, reason, who)),
    ),
  );

  server.registerTool(
    'regenerate_status',
    {
      description:
        "Regenerate a project's derived status.md. Two-call protocol: call with only project_id to get the computed rollup + rollup_hash; write a SHORT summary (2–4 sentences — the UI renders the counts, charts and lists itself, so prose should say what moved and what is stuck, not restate numbers), then call again with prose + rollup_hash to commit. If the rollup changed in between, you get the fresh rollup back to retry (or pass force: true).",
      inputSchema: {
        project_id: z.string(),
        prose: z.string().optional().describe('your 2–4 sentence summary for the ## Summary section'),
        rollup_hash: z.string().optional().describe('the hash returned by the first call'),
        force: z.boolean().optional().describe('write even if the rollup changed since the hash was issued'),
        actor,
      },
    },
    wrap(({ project_id, prose, rollup_hash: hash, force, actor: who }) => {
      fresh();
      const ws = spaceOfNode(project_id);
      const rollup = computeRollup(ws, project_id);
      const currentHash = rollupHash(rollup);
      if (!prose) {
        return json({
          rollup,
          rollup_hash: currentHash,
          instructions:
            'Write 2–4 sentences summarizing this rollup for a human reader (what moved, what is stuck, what is next). Do not restate the counts — the reading UI renders them as charts beside your prose. Then call regenerate_status again with { project_id, prose, rollup_hash }.',
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
      return json({ ok: true, space: ws.slug, ...result });
    }),
  );
}
