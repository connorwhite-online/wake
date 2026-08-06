import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDb } from './db.js';
import { dbPath } from './config.js';
import { catchUp, fullReindex, indexFile } from './indexer.js';
import { newId, slugify } from './ids.js';
import {
  type ActivityEvent,
  type EdgeType,
  type EventKind,
  type IssueState,
  type Node,
  ISSUE_STATES,
  EDGE_TYPES,
} from './schema.js';
import {
  appendActivity,
  assertPatchAllowed,
  loadNode,
  nowIso,
  readActivity,
  saveNode,
} from './store.js';
import * as P from './paths.js';
import { rowToSummary, searchNodes, type NodeSummary, type SearchResult } from './search.js';

export interface ActivityRow {
  node_id: string;
  ts: string;
  actor: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface CreateInput {
  type: 'project' | 'issue' | 'doc' | 'artifact';
  title: string;
  body?: string;
  tags?: string[];
  /** issues: id of the parent project */
  project_id?: string;
  /** issues: initial state (defaults to triage) */
  state?: IssueState;
  /** docs: path under docs/ (extension optional) */
  doc_path?: string;
  /** artifacts: text content of the blob */
  content?: string;
  /** artifacts: file extension for the blob, e.g. "csv" */
  ext?: string;
  mime?: string;
  actor?: string;
}

export class Workspace {
  private constructor(
    readonly root: string,
    readonly db: Database.Database,
  ) {}

  /** Open the workspace + index; rebuild or catch the index up as needed. */
  static open(root: string): Workspace {
    const { db, needsReindex } = openDb(dbPath(root));
    const ws = new Workspace(root, db);
    if (needsReindex) fullReindex(root, db);
    else catchUp(root, db);
    return ws;
  }

  close(): void {
    this.db.close();
  }

  // ---------- reads ----------

  nodeRow(id: string): Record<string, unknown> | undefined {
    return this.db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
  }

  requireRow(id: string): Record<string, unknown> {
    const row = this.nodeRow(id);
    if (!row) throw new Error(`no node with id ${id}`);
    return row;
  }

  summary(id: string): NodeSummary | undefined {
    const row = this.nodeRow(id);
    return row ? rowToSummary(row) : undefined;
  }

  loadById(id: string): Node {
    const row = this.requireRow(id);
    return loadNode(this.root, row.path as string);
  }

  projectBySlug(slug: string): NodeSummary | undefined {
    const row = this.db
      .prepare(`SELECT * FROM nodes WHERE type = 'project' AND slug = ?`)
      .get(slug) as Record<string, unknown> | undefined;
    return row ? rowToSummary(row) : undefined;
  }

  list(opts: {
    type?: string;
    project_id?: string;
    state?: string;
    tags?: string[];
    updated_since?: string;
    limit?: number;
    order?: 'updated' | 'created';
    include_archived?: boolean;
  }): NodeSummary[] {
    const limit = Math.min(opts.limit ?? 100, 500);
    const order = opts.order === 'created' ? 'created' : 'updated';
    const rows = this.db
      .prepare(
        `SELECT * FROM nodes
         WHERE (@type IS NULL OR type = @type)
           AND (@project_id IS NULL OR project_id = @project_id)
           AND (@state IS NULL OR state = @state)
           AND (@updated_since IS NULL OR updated >= @updated_since)
           AND (@include_archived = 1 OR archived = 0)
         ORDER BY ${order} DESC
         LIMIT @limit`,
      )
      .all({
        type: opts.type ?? null,
        project_id: opts.project_id ?? null,
        state: opts.state ?? null,
        updated_since: opts.updated_since ?? null,
        include_archived: opts.include_archived ? 1 : 0,
        limit,
      }) as Record<string, unknown>[];
    let results = rows.map(rowToSummary);
    if (opts.tags?.length) {
      const want = new Set(opts.tags);
      results = results.filter((r) => r.tags.some((t) => want.has(t)));
    }
    return results;
  }

  search(opts: {
    query: string;
    type?: string;
    tags?: string[];
    limit?: number;
    include_archived?: boolean;
  }): SearchResult[] {
    return searchNodes(this.db, opts);
  }

  /** Most recent activity timestamp across a project and its issues — the "is this alive" signal. */
  projectLastActive(projectId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(ts) t FROM activity
         WHERE node_id = @id
            OR node_id IN (SELECT id FROM nodes WHERE type = 'issue' AND project_id = @id)`,
      )
      .get({ id: projectId }) as { t: string | null };
    return row.t;
  }

  activityFor(nodeId: string, limit = 50): ActivityRow[] {
    const rows = this.db
      .prepare(`SELECT node_id, ts, actor, kind, payload FROM activity WHERE node_id = ? ORDER BY ts DESC LIMIT ?`)
      .all(nodeId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      node_id: r.node_id as string,
      ts: r.ts as string,
      actor: r.actor as string,
      kind: r.kind as string,
      payload: JSON.parse((r.payload as string) || '{}'),
    }));
  }

  recentActivity(limit = 50, since?: string): (ActivityRow & { node_title?: string; node_type?: string })[] {
    const rows = this.db
      .prepare(
        `SELECT a.node_id, a.ts, a.actor, a.kind, a.payload, n.title AS node_title, n.type AS node_type
         FROM activity a LEFT JOIN nodes n ON n.id = a.node_id
         WHERE (@since IS NULL OR a.ts >= @since)
         ORDER BY a.ts DESC LIMIT @limit`,
      )
      .all({ since: since ?? null, limit }) as Record<string, unknown>[];
    return rows.map((r) => ({
      node_id: r.node_id as string,
      ts: r.ts as string,
      actor: r.actor as string,
      kind: r.kind as string,
      payload: JSON.parse((r.payload as string) || '{}'),
      node_title: (r.node_title as string) ?? undefined,
      node_type: (r.node_type as string) ?? undefined,
    }));
  }

  /** Nodes linking TO this node: typed edges plus resolved wiki links. */
  backlinks(id: string): { node: NodeSummary; kind: string }[] {
    const title = (this.nodeRow(id)?.title as string) ?? '';
    const rows = this.db
      .prepare(
        `SELECT n.*, e.kind AS link_kind FROM edges e JOIN nodes n ON n.id = e.src WHERE e.dst = ?
         UNION
         SELECT n.*, 'references' AS link_kind FROM wikilinks w JOIN nodes n ON n.id = w.src
         WHERE w.target = ? OR (? != '' AND lower(w.target) = lower(?))`,
      )
      .all(id, id, title, title) as Record<string, unknown>[];
    return rows
      .filter((r) => r.id !== id)
      .map((r) => ({ node: rowToSummary(r), kind: r.link_kind as string }));
  }

  /** Resolve a wiki-link target ([[id]] or [[Title]]) to a node summary. */
  resolveWikiTarget(target: string): NodeSummary | undefined {
    const t = target.trim();
    const row =
      (this.db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(t) as Record<string, unknown> | undefined) ??
      (this.db.prepare(`SELECT * FROM nodes WHERE lower(title) = lower(?) LIMIT 1`).get(t) as
        | Record<string, unknown>
        | undefined);
    return row ? rowToSummary(row) : undefined;
  }

  readStatusFile(slug: string): string | undefined {
    const p = path.join(this.root, P.statusPath(slug));
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
  }

  // ---------- writes (file first, then write-through index, then activity) ----------

  private activityPathFor(row: Record<string, unknown>): string {
    const type = row.type as string;
    if (type === 'issue') {
      const projectRow = this.requireRow(row.project_id as string);
      return P.issueActivityPath(projectRow.slug as string, row.id as string);
    }
    if (type === 'project') return P.projectActivityPath(row.slug as string);
    return P.WORKSPACE_ACTIVITY_PATH;
  }

  private logEvent(row: Record<string, unknown>, kind: EventKind, payload: Record<string, unknown>, actor: string): ActivityEvent {
    const event: ActivityEvent = { ts: nowIso(), actor, node: row.id as string, kind, payload };
    const rel = this.activityPathFor(row);
    appendActivity(this.root, rel, event);
    indexFile(this.root, this.db, rel);
    return event;
  }

  create(input: CreateInput): { id: string; path: string } {
    const id = newId();
    const actor = input.actor ?? 'agent';
    const ts = nowIso();
    const base = {
      id,
      title: input.title,
      created: ts,
      updated: ts,
      author: actor,
      tags: input.tags ?? [],
      links: [],
      space: 'home',
      archived: false,
    };
    let relPath: string;
    let fm: Node['fm'];

    switch (input.type) {
      case 'project': {
        const slug = slugify(input.title);
        relPath = P.projectPath(slug);
        if (fs.existsSync(path.join(this.root, relPath))) {
          throw new Error(`project slug '${slug}' already exists`);
        }
        fm = { ...base, type: 'project' };
        break;
      }
      case 'issue': {
        if (!input.project_id) throw new Error('issues require project_id');
        const projectRow = this.requireRow(input.project_id);
        if (projectRow.type !== 'project') throw new Error(`${input.project_id} is not a project`);
        const state = input.state ?? 'triage';
        if (!ISSUE_STATES.includes(state)) throw new Error(`invalid initial state '${state}'`);
        relPath = P.issuePath(projectRow.slug as string, id);
        fm = { ...base, type: 'issue', state, project: input.project_id };
        break;
      }
      case 'doc': {
        const docRel = P.normalizeDocPath(input.doc_path ?? slugify(input.title));
        relPath = P.docPath(docRel);
        if (fs.existsSync(path.join(this.root, relPath))) {
          throw new Error(`doc already exists at ${relPath} — use write_doc or append_doc`);
        }
        fm = { ...base, type: 'doc' };
        break;
      }
      case 'artifact': {
        if (!input.content) throw new Error('artifact creation requires text content in v1');
        const ext = (input.ext ?? 'txt').replace(/^\./, '');
        const hash = crypto.createHash('sha256').update(input.content).digest('hex').slice(0, 16);
        const blobRel = P.artifactBlobPath(`${hash}.${ext}`);
        const blobAbs = path.join(this.root, blobRel);
        fs.mkdirSync(path.dirname(blobAbs), { recursive: true });
        fs.writeFileSync(blobAbs, input.content, 'utf8');
        relPath = P.artifactSidecarPath(hash);
        fm = {
          ...base,
          type: 'artifact',
          file: `${hash}.${ext}`,
          mime: input.mime ?? 'text/plain',
        };
        break;
      }
    }

    saveNode(this.root, relPath, fm, input.body ?? '');
    indexFile(this.root, this.db, relPath);
    const row = this.requireRow(id);
    const payload: Record<string, unknown> = { type: input.type, title: input.title };
    if (input.type === 'issue') payload.state = (fm as { state: string }).state;
    this.logEvent(row, 'created', payload, actor);
    return { id, path: relPath };
  }

  update(id: string, patch: Record<string, unknown>, actor = 'agent'): NodeSummary {
    assertPatchAllowed(patch);
    const row = this.requireRow(id);
    const node = loadNode(this.root, row.path as string);
    const { body, ...fmPatch } = patch;
    const fm = { ...node.fm, ...fmPatch, updated: nowIso() } as Node['fm'];
    const newBody = typeof body === 'string' ? body : node.body;
    saveNode(this.root, node.path, fm, newBody);
    indexFile(this.root, this.db, node.path);
    this.logEvent(row, 'field_updated', { fields: Object.keys(patch) }, actor);
    return this.summary(id)!;
  }

  setIssueState(id: string, state: IssueState, reason: string, actor = 'agent'): { from: string; to: string } {
    if (!ISSUE_STATES.includes(state)) throw new Error(`invalid state '${state}'`);
    const row = this.requireRow(id);
    if (row.type !== 'issue') throw new Error(`${id} is not an issue`);
    const node = this.loadById(id);
    if (node.fm.type !== 'issue') throw new Error(`${id} is not an issue`);
    const from = node.fm.state;
    if (from === state) throw new Error(`issue is already '${state}' — no transition to record`);
    node.fm.state = state;
    node.fm.updated = nowIso();
    saveNode(this.root, node.path, node.fm, node.body);
    indexFile(this.root, this.db, node.path);
    this.logEvent(row, 'state_changed', { from, to: state, reason }, actor);
    return { from, to: state };
  }

  logActivity(nodeId: string, text: string, payload: Record<string, unknown> = {}, actor = 'agent'): ActivityEvent {
    const row = this.requireRow(nodeId);
    return this.logEvent(row, 'note', { text, ...payload }, actor);
  }

  logRawEvent(nodeId: string, kind: EventKind, payload: Record<string, unknown>, actor = 'agent'): ActivityEvent {
    const row = this.requireRow(nodeId);
    return this.logEvent(row, kind, payload, actor);
  }

  /** Soft, reversible removal. Archived nodes stay on disk but leave lists, search, and rollups. */
  setArchived(id: string, archived: boolean, reason: string, actor = 'agent'): { id: string; archived: boolean } {
    const row = this.requireRow(id);
    const node = this.loadById(id);
    if (node.fm.archived === archived) {
      throw new Error(`node is already ${archived ? 'archived' : 'active'}`);
    }
    node.fm.archived = archived;
    node.fm.updated = nowIso();
    saveNode(this.root, node.path, node.fm, node.body);
    indexFile(this.root, this.db, node.path);
    this.logEvent(row, archived ? 'archived' : 'unarchived', { reason }, actor);
    return { id, archived };
  }

  appendDoc(id: string, section: string, content: string, actor = 'agent'): void {
    const row = this.requireRow(id);
    if (row.type !== 'doc') throw new Error(`${id} is not a doc`);
    const node = this.loadById(id);
    const heading = `## ${section}`;
    const lines = node.body.split('\n');
    const idx = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
    let body: string;
    if (idx === -1) {
      body = `${node.body.trimEnd()}\n\n${heading}\n\n${content.trim()}\n`;
    } else {
      let end = lines.length;
      for (let i = idx + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) {
          end = i;
          break;
        }
      }
      const before = lines.slice(0, end).join('\n').trimEnd();
      const after = lines.slice(end).join('\n');
      body = `${before}\n\n${content.trim()}\n${after ? '\n' + after : ''}`;
    }
    node.fm.updated = nowIso();
    saveNode(this.root, node.path, node.fm, body);
    indexFile(this.root, this.db, node.path);
    this.logEvent(row, 'doc_appended', { section }, actor);
  }

  writeDoc(
    docRelPath: string,
    content: string,
    title?: string,
    actor = 'agent',
    expectUpdated?: string,
  ): { id: string; path: string } {
    const rel = P.docPath(docRelPath);
    const absPath = path.join(this.root, rel);
    if (fs.existsSync(absPath)) {
      const existing = loadNode(this.root, rel);
      if (expectUpdated && existing.fm.updated !== expectUpdated) {
        throw new Error(
          `doc changed since you read it (updated ${existing.fm.updated}, you expected ${expectUpdated}) — ` +
            `re-read it with get_node and merge before replacing, or use append_doc`,
        );
      }
      existing.fm.updated = nowIso();
      if (title) existing.fm.title = title;
      saveNode(this.root, rel, existing.fm, content);
      indexFile(this.root, this.db, rel);
      const row = this.requireRow(existing.fm.id);
      this.logEvent(row, 'field_updated', { fields: ['body'], via: 'write_doc' }, actor);
      return { id: existing.fm.id, path: rel };
    }
    return this.create({
      type: 'doc',
      title: title ?? path.basename(rel, '.md'),
      body: content,
      doc_path: docRelPath,
      actor,
    });
  }

  addLink(a: string, b: string, type: EdgeType, actor = 'agent'): void {
    if (!EDGE_TYPES.includes(type)) throw new Error(`invalid edge type '${type}'`);
    const rowA = this.requireRow(a);
    const rowB = this.requireRow(b);
    const node = this.loadById(a);
    if (!node.fm.links.some((l) => l.to === b && l.type === type)) {
      node.fm.links.push({ to: b, type });
      node.fm.updated = nowIso();
      saveNode(this.root, node.path, node.fm, node.body);
      indexFile(this.root, this.db, node.path);
    }
    this.logEvent(rowA, 'linked', { to: b, type, direction: 'out' }, actor);
    this.logEvent(rowB, 'linked', { from: a, type, direction: 'in' }, actor);
  }

  /** Raw activity file access (used by tests and the rollup). */
  readActivityFile(relPath: string) {
    return readActivity(this.root, relPath);
  }
}
