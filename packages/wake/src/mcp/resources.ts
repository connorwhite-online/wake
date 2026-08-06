import fs from 'node:fs';
import path from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Hub } from '../core/spaces.js';
import { CONVENTIONS_PATH } from '../core/paths.js';

export function registerResources(server: McpServer, hub: Hub): void {
  server.registerResource(
    'conventions',
    'wake://conventions',
    {
      description: 'The workspace contract: spaces and projects, file layout, frontmatter schemas, what is derived and hands-off.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const first = hub.spaces()[0];
      const p = first ? path.join(first.path, CONVENTIONS_PATH) : '';
      const text = p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'No CONVENTIONS.md in this workspace.';
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  server.registerResource(
    'spaces',
    'wake://spaces',
    {
      description: 'Every space you can reach and the projects inside it — the cheap way to orient.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const spaces = hub.spaces().map((info) => {
        const ws = hub.workspace(info.slug);
        return {
          slug: info.slug,
          name: info.name,
          description: info.description,
          projects: ws.list({ type: 'project' }).map((p) => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            last_active: ws.projectLastActive(p.id),
            issues: Object.fromEntries(
              (
                ws.db
                  .prepare(
                    `SELECT state, COUNT(*) c FROM nodes WHERE type='issue' AND project_id=? AND archived=0 GROUP BY state`,
                  )
                  .all(p.id) as { state: string; c: number }[]
              ).map((r) => [r.state, r.c]),
            ),
          })),
        };
      });
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(spaces, null, 2) }] };
    },
  );

  server.registerResource(
    'doc',
    new ResourceTemplate('wake://s/{space}/docs/{+path}', {
      list: async () => ({
        resources: hub.all().flatMap(({ info, ws }) =>
          ws.list({ type: 'doc', limit: 500 }).map((d) => ({
            uri: `wake://s/${info.slug}/${d.path.replace(/\.md$/, '')}`,
            name: `${info.name} · ${d.title}`,
            mimeType: 'text/markdown',
          })),
        ),
      }),
    }),
    { description: 'A doc from a space, as raw markdown.' },
    async (uri, variables) => {
      const ws = hub.workspace(String(variables.space));
      const rel = String(variables.path ?? '');
      const file = path.join(ws.root, 'docs', rel.endsWith('.md') ? rel : `${rel}.md`);
      if (!file.startsWith(path.join(ws.root, 'docs'))) throw new Error('doc resources live under docs/');
      if (!fs.existsSync(file)) throw new Error(`no doc at ${rel}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: fs.readFileSync(file, 'utf8') }] };
    },
  );

  server.registerResource(
    'status',
    new ResourceTemplate('wake://s/{space}/projects/{slug}/status', {
      list: async () => ({
        resources: hub.all().flatMap(({ info, ws }) =>
          ws
            .list({ type: 'project' })
            .filter((p) => p.slug && ws.readStatusFile(p.slug))
            .map((p) => ({
              uri: `wake://s/${info.slug}/projects/${p.slug}/status`,
              name: `${info.name} · ${p.title} — status`,
              mimeType: 'text/markdown',
            })),
        ),
      }),
    }),
    { description: "A project's derived status.md — the living rollup of where it stands." },
    async (uri, variables) => {
      const ws = hub.workspace(String(variables.space));
      const text = ws.readStatusFile(String(variables.slug));
      if (!text) throw new Error(`no status.md for that project — call regenerate_status first`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );
}
