import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventEmitter } from 'node:events';
import matter from 'gray-matter';
import type { Workspace } from '../core/workspace.js';
import { renderMarkdown, nodeUrl } from '../core/markdown.js';
import { rowToSummary, type NodeSummary } from '../core/search.js';

function issueCounts(ws: Workspace, projectId: string): Record<string, number> {
  return Object.fromEntries(
    (
      ws.db
        .prepare(`SELECT state, COUNT(*) c FROM nodes WHERE type = 'issue' AND project_id = ? GROUP BY state`)
        .all(projectId) as { state: string; c: number }[]
    ).map((r) => [r.state, r.c]),
  );
}

function withUrl(n: NodeSummary) {
  return { ...n, url: nodeUrl(n) };
}

function activityWithUrls(ws: Workspace, rows: ReturnType<Workspace['recentActivity']>) {
  return rows.map((a) => {
    const node = ws.summary(a.node_id);
    return { ...a, node_url: node ? nodeUrl(node) : null, node_type: node?.type ?? a.node_type };
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

/** Drop a leading <h1> that just repeats the page title — the UI already renders it. */
function stripDuplicateH1(html: string, title: string): string {
  const m = html.match(/^\s*<h1>(.*?)<\/h1>/);
  if (m && m[1].replace(/<[^>]+>/g, '').trim().toLowerCase() === title.trim().toLowerCase()) {
    return html.slice(m.index! + m[0].length);
  }
  return html;
}

function nodePayload(ws: Workspace, id: string) {
  const row = ws.requireRow(id);
  const summary = rowToSummary(row);
  const node = ws.loadById(id);
  const fm = node.fm as Record<string, unknown>;
  const links = (fm.links as { to: string; type: string }[] | undefined) ?? [];
  const project =
    summary.project_id != null ? (ws.summary(summary.project_id) ?? null) : null;
  return {
    node: withUrl(summary),
    body_html: stripDuplicateH1(renderMarkdown(ws, node.body), summary.title),
    project: project ? { id: project.id, title: project.title, slug: project.slug } : null,
    artifact:
      node.fm.type === 'artifact'
        ? { file: node.fm.file, mime: node.fm.mime, url: `/api/artifacts/${node.fm.file}` }
        : null,
    links: links
      .map((l) => {
        const target = ws.summary(l.to);
        return target ? { ...withUrl(target), kind: l.type } : null;
      })
      .filter(Boolean),
    backlinks: ws.backlinks(id).map((b) => ({ ...withUrl(b.node), kind: b.kind })),
    activity: activityWithUrls(
      ws,
      // per-node activity rows carry no join info — they are all about this node
      ws.activityFor(id, 100).map((a) => ({ ...a, node_title: summary.title, node_type: summary.type })),
    ),
  };
}

export function buildApi(ws: Workspace, bus: EventEmitter): Hono {
  const app = new Hono();

  app.get('/api/home', (c) => {
    const projects = ws.list({ type: 'project' }).map((p) => ({ ...withUrl(p), counts: issueCounts(ws, p.id) }));
    const statuses = ws
      .list({ type: 'project' })
      .map((p) => readStatus(ws, p))
      .filter((s): s is StatusInfo => s !== null)
      .map(({ full_html: _full, ...rest }) => rest);
    return c.json({
      projects,
      statuses,
      activity: activityWithUrls(ws, ws.recentActivity(60)),
    });
  });

  app.get('/api/projects', (c) => {
    const projects = ws.list({ type: 'project' }).map((p) => ({ ...withUrl(p), counts: issueCounts(ws, p.id) }));
    return c.json({ projects });
  });

  app.get('/api/projects/:slug', (c) => {
    const project = ws.projectBySlug(c.req.param('slug'));
    if (!project) return c.json({ error: 'no such project' }, 404);
    const node = ws.loadById(project.id);
    const issues = ws.list({ type: 'issue', project_id: project.id, limit: 500 });
    const grouped: Record<string, ReturnType<typeof withUrl>[]> = {};
    for (const i of issues) (grouped[i.state ?? 'triage'] ??= []).push(withUrl(i));
    const issueIds = new Set(issues.map((i) => i.id));
    const timeline = activityWithUrls(
      ws,
      ws.recentActivity(500).filter((a) => a.node_id === project.id || issueIds.has(a.node_id)),
    ).slice(0, 100);
    const status = readStatus(ws, project);
    return c.json({
      project: { ...withUrl(project), body_html: stripDuplicateH1(renderMarkdown(ws, node.body), project.title) },
      status: status ? { generated: status.generated, generated_by: status.generated_by, html: status.full_html } : null,
      issues: grouped,
      timeline,
      docs: ws
        .backlinks(project.id)
        .filter((b) => b.node.type === 'doc')
        .map((b) => withUrl(b.node)),
    });
  });

  app.get('/api/nodes/:id', (c) => {
    try {
      return c.json(nodePayload(ws, c.req.param('id')));
    } catch {
      return c.json({ error: 'no such node' }, 404);
    }
  });

  app.get('/api/docs', (c) => {
    return c.json({ docs: ws.list({ type: 'doc', limit: 500 }).map(withUrl) });
  });

  app.get('/api/docs/*', (c) => {
    const rel = `docs/${c.req.path.replace(/^\/api\/docs\//, '')}${c.req.path.endsWith('.md') ? '' : '.md'}`;
    const row = ws.db.prepare(`SELECT id FROM nodes WHERE path = ?`).get(decodeURIComponent(rel)) as
      | { id: string }
      | undefined;
    if (!row) return c.json({ error: 'no such doc' }, 404);
    return c.json(nodePayload(ws, row.id));
  });

  app.get('/api/search', (c) => {
    const q = c.req.query('q') ?? '';
    if (!q.trim()) return c.json({ results: [] });
    const tags = (c.req.query('tags') ?? '').split(',').filter(Boolean);
    const results = ws
      .search({ query: q, type: c.req.query('type') || undefined, tags: tags.length ? tags : undefined })
      .map((r) => ({ ...r, url: nodeUrl(r) }));
    return c.json({ results });
  });

  app.get('/api/artifacts/:file', (c) => {
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
