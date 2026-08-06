import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { classify } from './paths.js';
import { loadNode, readActivity } from './store.js';
import type { Node } from './schema.js';

const SKIP_DIRS = new Set(['.wake', '.git', 'node_modules']);

export const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function extractWikiTargets(body: string): string[] {
  const targets = new Set<string>();
  for (const m of body.matchAll(WIKI_LINK_RE)) targets.add(m[1].trim());
  return [...targets];
}

function statFile(ws: string, relPath: string): { mtime: number; size: number } | null {
  try {
    const st = fs.statSync(path.join(ws, relPath));
    return { mtime: Math.floor(st.mtimeMs), size: st.size };
  } catch {
    return null;
  }
}

function upsertNode(db: Database.Database, node: Node, relPath: string): void {
  const fm = node.fm as Record<string, unknown> & Node['fm'];
  const cls = classify(relPath);
  const slug = cls.kind === 'project' ? cls.slug : null;
  const state = fm.type === 'issue' ? (fm as { state: string }).state : null;
  const projectId = fm.type === 'issue' ? (fm as { project: string }).project : null;

  // A moved/recreated file may reuse a path with a new id, or an id with a new
  // path — clear both stale rows before upserting.
  const byPath = db.prepare(`SELECT id FROM nodes WHERE path = ?`).get(relPath) as { id: string } | undefined;
  if (byPath && byPath.id !== fm.id) db.prepare(`DELETE FROM nodes WHERE path = ?`).run(relPath);

  db.prepare(
    `INSERT INTO nodes (id, type, title, path, slug, space, state, project_id, author, created, updated, tags, extra, body)
     VALUES (@id, @type, @title, @path, @slug, @space, @state, @project_id, @author, @created, @updated, @tags, @extra, @body)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, title=excluded.title, path=excluded.path, slug=excluded.slug,
       space=excluded.space, state=excluded.state, project_id=excluded.project_id,
       author=excluded.author, created=excluded.created, updated=excluded.updated,
       tags=excluded.tags, extra=excluded.extra, body=excluded.body`,
  ).run({
    id: fm.id,
    type: fm.type,
    title: fm.title,
    path: relPath,
    slug,
    space: fm.space,
    state,
    project_id: projectId,
    author: fm.author,
    created: fm.created,
    updated: fm.updated,
    tags: JSON.stringify(fm.tags),
    extra: JSON.stringify(fm),
    body: node.body,
  });

  db.prepare(`DELETE FROM edges WHERE src = ?`).run(fm.id);
  const insEdge = db.prepare(`INSERT OR IGNORE INTO edges (src, dst, kind) VALUES (?, ?, ?)`);
  for (const link of fm.links) insEdge.run(fm.id, link.to, link.type);

  db.prepare(`DELETE FROM wikilinks WHERE src = ?`).run(fm.id);
  const insWiki = db.prepare(`INSERT OR IGNORE INTO wikilinks (src, target) VALUES (?, ?)`);
  for (const target of extractWikiTargets(node.body)) insWiki.run(fm.id, target);
}

/**
 * Index a single workspace-relative file. Idempotent — safe to call from a
 * write-through writer and again from the watcher for the same change.
 */
export function indexFile(ws: string, db: Database.Database, relPath: string): void {
  const cls = classify(relPath);
  if (cls.kind === 'ignore') return;
  const st = statFile(ws, relPath);
  if (!st) {
    removeFile(ws, db, relPath);
    return;
  }

  if (cls.kind === 'activity') {
    const prev = db.prepare(`SELECT lines FROM files WHERE path = ?`).get(relPath) as { lines: number } | undefined;
    let fromLine = prev?.lines ?? 0;
    // A shrunk log means the file was rewritten; drop its rows and re-tail.
    const { events, totalLines } = readActivity(ws, relPath, 0);
    if (totalLines < fromLine) {
      db.prepare(`DELETE FROM activity WHERE src_file = ?`).run(relPath);
      fromLine = 0;
    }
    const ins = db.prepare(
      `INSERT OR IGNORE INTO activity (node_id, ts, actor, kind, payload, src_file, src_line)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { event, line } of events) {
      if (line < fromLine) continue;
      ins.run(event.node, event.ts, event.actor, event.kind, JSON.stringify(event.payload), relPath, line);
    }
    db.prepare(
      `INSERT INTO files (path, mtime, size, node_id, lines) VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, lines=excluded.lines`,
    ).run(relPath, st.mtime, st.size, totalLines);
    return;
  }

  if (cls.kind === 'status') {
    // status.md is derived output, read from disk at request time — track only for change detection
    db.prepare(
      `INSERT INTO files (path, mtime, size, node_id, lines) VALUES (?, ?, ?, NULL, 0)
       ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size`,
    ).run(relPath, st.mtime, st.size);
    return;
  }

  let node: Node;
  try {
    node = loadNode(ws, relPath);
  } catch (err) {
    console.error(`wake index: skipping invalid file ${relPath}: ${(err as Error).message}`);
    db.prepare(
      `INSERT INTO files (path, mtime, size, node_id, lines) VALUES (?, ?, ?, NULL, 0)
       ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, node_id=NULL`,
    ).run(relPath, st.mtime, st.size);
    return;
  }
  upsertNode(db, node, relPath);
  db.prepare(
    `INSERT INTO files (path, mtime, size, node_id, lines) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, node_id=excluded.node_id`,
  ).run(relPath, st.mtime, st.size, node.fm.id);
}

export function removeFile(_ws: string, db: Database.Database, relPath: string): void {
  const row = db.prepare(`SELECT node_id FROM files WHERE path = ?`).get(relPath) as
    | { node_id: string | null }
    | undefined;
  if (row?.node_id) {
    db.prepare(`DELETE FROM nodes WHERE id = ?`).run(row.node_id);
    db.prepare(`DELETE FROM edges WHERE src = ?`).run(row.node_id);
    db.prepare(`DELETE FROM wikilinks WHERE src = ?`).run(row.node_id);
  } else {
    db.prepare(`DELETE FROM nodes WHERE path = ?`).run(relPath);
  }
  db.prepare(`DELETE FROM activity WHERE src_file = ?`).run(relPath);
  db.prepare(`DELETE FROM files WHERE path = ?`).run(relPath);
}

function walkFiles(ws: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(ws, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const rel = path.relative(ws, path.join(e.parentPath, e.name)).replace(/\\/g, '/');
    const top = rel.split('/')[0];
    if (SKIP_DIRS.has(top)) continue;
    out.push(rel);
  }
  return out;
}

/** Wipe the index tables and rebuild from a full workspace walk. */
export function fullReindex(ws: string, db: Database.Database): { indexed: number } {
  const run = db.transaction(() => {
    for (const t of ['nodes', 'edges', 'wikilinks', 'activity', 'files']) db.exec(`DELETE FROM ${t}`);
    const files = walkFiles(ws);
    for (const f of files) indexFile(ws, db, f);
    return files.length;
  });
  return { indexed: run() };
}

/**
 * Cheap startup scan: compare mtime/size against the files table, index what
 * changed, remove what disappeared. Makes any entrypoint correct even when no
 * watcher was running.
 */
export function catchUp(ws: string, db: Database.Database): { changed: number; removed: number } {
  const run = db.transaction(() => {
    const known = new Map<string, { mtime: number; size: number }>();
    for (const row of db.prepare(`SELECT path, mtime, size FROM files`).all() as {
      path: string;
      mtime: number;
      size: number;
    }[]) {
      known.set(row.path, row);
    }
    let changed = 0;
    const seen = new Set<string>();
    for (const rel of walkFiles(ws)) {
      seen.add(rel);
      if (classify(rel).kind === 'ignore') continue;
      const st = statFile(ws, rel);
      if (!st) continue;
      const prev = known.get(rel);
      if (!prev || prev.mtime !== st.mtime || prev.size !== st.size) {
        indexFile(ws, db, rel);
        changed++;
      }
    }
    let removed = 0;
    for (const p of known.keys()) {
      if (!seen.has(p)) {
        removeFile(ws, db, p);
        removed++;
      }
    }
    return { changed, removed };
  });
  return run();
}
