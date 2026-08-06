import fs from 'node:fs';
import path from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Workspace } from '../core/workspace.js';
import { CONVENTIONS_PATH } from '../core/paths.js';

export function registerResources(server: McpServer, ws: Workspace): void {
  server.registerResource(
    'conventions',
    'wake://conventions',
    {
      description: 'The workspace contract: file layout, frontmatter schemas, what is derived and hands-off.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const p = path.join(ws.root, CONVENTIONS_PATH);
      const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'No CONVENTIONS.md in this workspace.';
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  server.registerResource(
    'projects',
    'wake://index/projects',
    {
      description: 'All projects with issue counts by state — the cheap way to orient in the workspace.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const projects = ws.list({ type: 'project' }).map((p) => ({
        ...p,
        issues: Object.fromEntries(
          (
            ws.db
              .prepare(`SELECT state, COUNT(*) c FROM nodes WHERE type='issue' AND project_id = ? GROUP BY state`)
              .all(p.id) as { state: string; c: number }[]
          ).map((r) => [r.state, r.c]),
        ),
      }));
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(projects, null, 2) }] };
    },
  );

  server.registerResource(
    'doc',
    new ResourceTemplate('wake://docs/{+path}', {
      list: async () => ({
        resources: ws.list({ type: 'doc', limit: 500 }).map((d) => ({
          uri: `wake://${d.path.replace(/\.md$/, '')}`,
          name: d.title,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    { description: 'A doc from the workspace knowledge base, as raw markdown.' },
    async (uri) => {
      const rel = uri.href.replace(/^wake:\/\//, '');
      const p = path.join(ws.root, rel.endsWith('.md') ? rel : `${rel}.md`);
      if (!p.startsWith(path.join(ws.root, 'docs'))) throw new Error('doc resources live under docs/');
      if (!fs.existsSync(p)) throw new Error(`no doc at ${rel}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: fs.readFileSync(p, 'utf8') }] };
    },
  );

  server.registerResource(
    'status',
    new ResourceTemplate('wake://projects/{slug}/status', {
      list: async () => ({
        resources: ws
          .list({ type: 'project' })
          .filter((p) => p.slug && ws.readStatusFile(p.slug))
          .map((p) => ({
            uri: `wake://projects/${p.slug}/status`,
            name: `${p.title} — status`,
            mimeType: 'text/markdown',
          })),
      }),
    }),
    { description: "A project's derived status.md — the living rollup of where it stands." },
    async (uri, variables) => {
      const slug = String(variables.slug);
      const text = ws.readStatusFile(slug);
      if (!text) throw new Error(`no status.md for project '${slug}' — call regenerate_status first`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );
}
