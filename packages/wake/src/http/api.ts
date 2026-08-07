import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventEmitter } from 'node:events';
import matter from 'gray-matter';
import type { Workspace } from '../core/workspace.js';
import type { Hub, SpaceInfo } from '../core/spaces.js';
import { createSpace, loadUser, saveUser, updateSpace } from '../core/spaces.js';
import { renderMarkdown, nodeUrl } from '../core/markdown.js';
import { computeRollup } from '../core/rollup.js';
import { loadSettings } from '../core/settings.js';
import { rowToSummary, type NodeSummary } from '../core/search.js';

function issueCounts(ws: Workspace, projectId: string): Record<string, number> {
  return Object.fromEntries(
    (
      ws.db
        .prepare(`SELECT state, COUNT(*) c FROM nodes WHERE type = 'issue' AND project_id = ? AND archived = 0 GROUP BY state`)
        .all(projectId) as { state: string; c: number }[]
    ).map((r) => [r.state, r.c]),
  );
}

function withUrl(ws: Workspace, n: NodeSummary) {
  return { ...n, url: nodeUrl(n, ws.slug), space: ws.slug };
}

function activityWithUrls(ws: Workspace, rows: ReturnType<Workspace['recentActivity']>) {
  return rows.map((a) => {
    const node = ws.summary(a.node_id);
    return {
      ...a,
      node_url: node ? nodeUrl(node, ws.slug) : null,
      node_type: node?.type ?? a.node_type,
    };
  });
}

interface StatusInfo {
  project_id: string;
  title: string;
  slug: string;
  generated: string | null;
  generated_by: string | null;
  summary_html: string;
  full_html: string;
}

function readStatus(ws: Workspace, project: NodeSummary): StatusInfo | null {
  if (!project.slug) return null;
  const raw = ws.readStatusFile(project.slug);
  if (!raw) return null;
  const { data, content } = matter(raw);
  const summaryMatch = content.match(/## Summary\s*\n([\s\S]*?)(?=\n## |$)/);
  return {
    project_id: project.id,
    title: project.title,
    slug: project.slug,
    generated: data.generated ? new Date(data.generated).toISOString() : null,
    generated_by: (data.generated_by as string) ?? null,
    summary_html: renderMarkdown(ws, (summaryMatch?.[1] ?? '').trim()),
    full_html: renderMarkdown(ws, content),
  };
}

function nodePayload(ws: Workspace, id: string) {
  const row = ws.requireRow(id);
  const summary = rowToSummary(row);
  const node = ws.loadById(id);
  const fm = node.fm as Record<string, unknown>;
  const links = (fm.links as { to: string; type: string }[] | undefined) ?? [];
  const project = summary.project_id != null ? (ws.summary(summary.project_id) ?? null) : null;
  return {
    node: withUrl(ws, summary),
    body_html: renderMarkdown(ws, node.body),
    project: project ? { id: project.id, title: project.title, slug: project.slug } : null,
    artifact:
      node.fm.type === 'artifact'
        ? { file: node.fm.file, mime: node.fm.mime, url: `/api/s/${ws.slug}/artifacts/${node.fm.file}` }
        : null,
    links: links
      .map((l) => {
        const target = ws.summary(l.to);
        return target ? { ...withUrl(ws, target), kind: l.type } : null;
      })
      .filter(Boolean),
    backlinks: ws.backlinks(id).map((b) => ({ ...withUrl(ws, b.node), kind: b.kind })),
    activity: activityWithUrls(ws, ws.activityFor(id, 100) as ReturnType<Workspace['recentActivity']>),
  };
}

function spaceSummary(hub: Hub, info: SpaceInfo) {
  const ws = hub.workspace(info.slug);
  const projects = ws.list({ type: 'project' });
  return {
    slug: info.slug,
    name: info.name,
    description: info.description,
    repos: info.repos,
    url: `/s/${info.slug}`,
    projects: projects.length,
    issues: (ws.db.prepare(`SELECT COUNT(*) c FROM nodes WHERE type='issue' AND archived=0`).get() as { c: number }).c,
    last_active: projects
      .map((p) => ws.projectLastActive(p.id))
      .filter(Boolean)
      .sort()
      .pop() ?? null,
  };
}

export interface ApiOptions {
  /** only the full-access caller may add spaces; a scoped token may not */
  canCreateSpaces?: boolean;
}

export function buildApi(hub: Hub, bus: EventEmitter, opts: ApiOptions = {}): Hono {
  const app = new Hono();

  /** Resolve the :space param to an open workspace, 404ing cleanly. */
  const spaceOf = (c: { req: { param: (n: string) => string } }): Workspace | null => {
    try {
      return hub.workspace(c.req.param('space'));
    } catch {
      return null;
    }
  };

  app.get('/api/me', (c) => {
    const user = loadUser(hub.home);
    return c.json({ user, spaces: hub.spaces().map((s) => spaceSummary(hub, s)) });
  });

  app.get('/api/spaces', (c) => c.json({ spaces: hub.spaces().map((s) => spaceSummary(hub, s)) }));

  app.patch('/api/me', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
    if (!body?.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const name = body.name.trim().slice(0, 80);
    const profile = { name, handle: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'you' };
    saveUser(hub.home, profile);
    return c.json({ user: profile });
  });

  app.post('/api/spaces', async (c) => {
    if (!opts.canCreateSpaces) return c.json({ error: 'this token cannot create spaces' }, 403);
    const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
    if (!body?.name?.trim()) return c.json({ error: 'name is required' }, 400);
    try {
      const info = createSpace(hub.home, body.name.trim());
      hub.refresh();
      return c.json({ space: spaceSummary(hub, info) }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  app.patch('/api/spaces/:slug', async (c) => {
    const info = hub.info(c.req.param('slug'));
    if (!info) return c.json({ error: 'no such space' }, 404);
    const body = (await c.req.json().catch(() => null)) as { name?: string; description?: string } | null;
    if (!body) return c.json({ error: 'body must be JSON' }, 400);
    const updated = updateSpace(info.path, body);
    info.name = updated.name;
    info.description = updated.description;
    return c.json({ space: spaceSummary(hub, info) });
  });

  app.get('/api/s/:space/meta', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.json({ error: 'no such space' }, 404);
    // settings re-read per request so a wake.json edit shows up on refresh
    return c.json({ ...loadSettings(ws.root), space: hub.info(ws.slug) });
  });

  app.get('/api/s/:space/home', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.json({ error: 'no such space' }, 404);
    const projects = ws
      .list({ type: 'project' })
      .map((p) => ({ ...withUrl(ws, p), counts: issueCounts(ws, p.id), last_active: ws.projectLastActive(p.id) }))
      .sort((a, b) => (b.last_active ?? b.updated).localeCompare(a.last_active ?? a.updated));
    // the rollup is computed live from the index, so charts are never stale —
    // only the agent's prose is stored
    const statuses = ws
      .list({ type: 'project' })
      .map((p) => readStatus(ws, p))
      .filter((s): s is StatusInfo => s !== null)
      .map(({ full_html: _full, ...rest }) => ({ ...rest, rollup: computeRollup(ws, rest.project_id) }));
    return c.json({ projects, statuses, activity: activityWithUrls(ws, ws.recentActivity(60)) });
  });

  app.get('/api/s/:space/projects', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.json({ error: 'no such space' }, 404);
    const projects = ws
      .list({ type: 'project' })
      .map((p) => ({ ...withUrl(ws, p), counts: issueCounts(ws, p.id), last_active: ws.projectLastActive(p.id) }))
      .sort((a, b) => (b.last_active ?? b.updated).localeCompare(a.last_active ?? a.updated));
    return c.json({ projects });
  });

  app.get('/api/s/:space/projects/:slug', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.json({ error: 'no such space' }, 404);
    const project = ws.projectBySlug(c.req.param('slug'));
    if (!project) return c.json({ error: 'no such project' }, 404);
    const node = ws.loadById(project.id);
    const issues = ws.list({ type: 'issue', project_id: project.id, limit: 500 });
    const grouped: Record<string, ReturnType<typeof withUrl>[]> = {};
    for (const i of issues) (grouped[i.state ?? 'triage'] ??= []).push(withUrl(ws, i));
    const issueIds = new Set(issues.map((i) => i.id));
    const timeline = activityWithUrls(
      ws,
      ws.recentActivity(500).filter((a) => a.node_id === project.id || issueIds.has(a.node_id)),
    ).slice(0, 100);
    const status = readStatus(ws, project);
    return c.json({
      project: { ...withUrl(ws, project), body_html: renderMarkdown(ws, node.body) },
      status: status
        ? {
            generated: status.generated,
            generated_by: status.generated_by,
            html: status.full_html,
            summary_html: status.summary_html,
          }
        : null,
      rollup: computeRollup(ws, project.id),
      issues: grouped,
      timeline,
      docs: ws
        .backlinks(project.id)
        .filter((b) => b.node.type === 'doc')
        .map((b) => withUrl(ws, b.node)),
    });
  });

  app.get('/api/s/:space/nodes/:id', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.json({ error: 'no such space' }, 404);
    try {
      return c.json(nodePayload(ws, c.req.param('id')));
    } catch {
      return c.json({ error: 'no such node' }, 404);
    }
  });

  app.get('/api/s/:space/docs', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.json({ error: 'no such space' }, 404);
    return c.json({ docs: ws.list({ type: 'doc', limit: 500 }).map((d) => withUrl(ws, d)) });
  });

  app.get('/api/s/:space/docs/*', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.json({ error: 'no such space' }, 404);
    const tail = c.req.path.replace(new RegExp(`^/api/s/${ws.slug}/docs/`), '');
    const rel = `docs/${decodeURIComponent(tail)}${tail.endsWith('.md') ? '' : '.md'}`;
    const row = ws.db.prepare(`SELECT id FROM nodes WHERE path = ?`).get(rel) as { id: string } | undefined;
    if (!row) return c.json({ error: 'no such doc' }, 404);
    return c.json(nodePayload(ws, row.id));
  });

  app.get('/api/s/:space/search', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.json({ error: 'no such space' }, 404);
    const q = c.req.query('q') ?? '';
    if (!q.trim()) return c.json({ results: [] });
    const tags = (c.req.query('tags') ?? '').split(',').filter(Boolean);
    const results = ws
      .search({ query: q, type: c.req.query('type') || undefined, tags: tags.length ? tags : undefined })
      .map((r) => ({ ...r, url: nodeUrl(r, ws.slug), space: ws.slug }));
    return c.json({ results });
  });

  /** Search every visible space at once — the user's whole graph. */
  app.get('/api/search', (c) => {
    const q = c.req.query('q') ?? '';
    if (!q.trim()) return c.json({ results: [] });
    const results = hub
      .all()
      .flatMap(({ info, ws }) =>
        ws
          .search({ query: q, type: c.req.query('type') || undefined, limit: 20 })
          .map((r) => ({ ...r, url: nodeUrl(r, ws.slug), space: ws.slug, space_name: info.name })),
      )
      .sort((a, b) => a.score - b.score)
      .slice(0, 40);
    return c.json({ results });
  });

  app.get('/api/s/:space/artifacts/:file', (c) => {
    const ws = spaceOf(c);
    if (!ws) return c.text('no such space', 404);
    const file = c.req.param('file');
    if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes('..')) return c.text('bad path', 400);
    const p = path.join(ws.root, 'artifacts', file);
    if (!fs.existsSync(p)) return c.text('not found', 404);
    const sidecar = ws.db
      .prepare(`SELECT extra FROM nodes WHERE type = 'artifact' AND json_extract(extra, '$.file') = ?`)
      .get(file) as { extra: string } | undefined;
    const mime = sidecar ? (JSON.parse(sidecar.extra).mime as string) : 'application/octet-stream';
    return c.body(fs.readFileSync(p), 200, { 'Content-Type': mime });
  });

  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      let alive = true;
      const listener = (rel: string) => {
        void stream.writeSSE({ event: 'change', data: rel });
      };
      bus.on('change', listener);
      stream.onAbort(() => {
        alive = false;
        bus.off('change', listener);
      });
      while (alive) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(15000);
      }
    });
  });

  return app;
}
