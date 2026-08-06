import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { indexFile } from './indexer.js';
import { statusPath } from './paths.js';
import { nowIso } from './store.js';
import type { Workspace } from './workspace.js';
import type { NodeSummary } from './search.js';

const RECENT_DAYS = 14;
const ACTIVE_HINT_DAYS = 3;

export interface IssueRef {
  id: string;
  title: string;
  state: string;
  updated: string;
  last_activity: string | null;
}

export interface Rollup {
  project_id: string;
  project_title: string;
  counts: Record<string, number>;
  now: IssueRef[];
  blocked: (IssueRef & { blocked_by: { id: string; title: string }[] })[];
  recently_done: IssueRef[];
  stale: IssueRef[];
  active_hint: IssueRef[];
  latest_activity: { ts: string; actor: string; kind: string; node_title: string; summary: string }[];
}

function dayCutoff(days: number, today: string): string {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function eventSummary(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'state_changed':
      return `${payload.from} → ${payload.to}${payload.reason ? `: ${payload.reason}` : ''}`;
    case 'note':
      return String(payload.text ?? '');
    case 'created':
      return `created ${payload.type ?? 'node'}`;
    case 'linked':
      return `linked (${payload.type})`;
    case 'doc_appended':
      return `appended to §${payload.section}`;
    case 'status_regenerated':
      return 'status regenerated';
    case 'field_updated':
      return `updated ${(payload.fields as string[])?.join(', ') ?? 'fields'}`;
    default:
      return kind;
  }
}

/**
 * Pure-ish rollup over the index. Date cutoffs are day-granular (from `today`,
 * YYYY-MM-DD) so the hash stays stable across the two-call prose handshake.
 */
export function computeRollup(ws: Workspace, projectId: string, today = new Date().toISOString().slice(0, 10)): Rollup {
  const project = ws.requireRow(projectId);
  if (project.type !== 'project') throw new Error(`${projectId} is not a project`);
  const issues = ws.list({ type: 'issue', project_id: projectId, limit: 500 });

  const lastActivity = new Map<string, string>();
  for (const issue of issues) {
    const events = ws.activityFor(issue.id, 1);
    if (events.length) lastActivity.set(issue.id, events[0].ts);
  }
  const ref = (i: NodeSummary): IssueRef => ({
    id: i.id,
    title: i.title,
    state: i.state ?? 'triage',
    updated: i.updated,
    last_activity: lastActivity.get(i.id) ?? null,
  });

  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.state ?? 'triage'] = (counts[i.state ?? 'triage'] ?? 0) + 1;

  const recentCutoff = dayCutoff(RECENT_DAYS, today);
  const hintCutoff = dayCutoff(ACTIVE_HINT_DAYS, today);

  const inProgress = issues.filter((i) => i.state === 'in-progress');
  const blockedIssues = issues.filter((i) => i.state === 'blocked');

  const blocked = blockedIssues.map((i) => ({
    ...ref(i),
    blocked_by: (
      ws.db
        .prepare(
          `SELECT n.id, n.title FROM edges e JOIN nodes n ON n.id = e.src
           WHERE e.dst = ? AND e.kind = 'blocks'`,
        )
        .all(i.id) as { id: string; title: string }[]
    ),
  }));

  const projectActivity = ws
    .recentActivity(200)
    .filter((a) => a.node_id === projectId || issues.some((i) => i.id === a.node_id));

  return {
    project_id: projectId,
    project_title: project.title as string,
    counts,
    now: inProgress.map(ref),
    blocked,
    recently_done: issues.filter((i) => i.state === 'done' && i.updated >= recentCutoff).map(ref),
    stale: inProgress
      .map(ref)
      .filter((r) => (r.last_activity ?? r.updated) < recentCutoff),
    active_hint: issues
      .filter((i) => i.state === 'todo')
      .map(ref)
      .filter((r) => r.last_activity !== null && r.last_activity >= hintCutoff),
    latest_activity: projectActivity.slice(0, 10).map((a) => ({
      ts: a.ts,
      actor: a.actor,
      kind: a.kind,
      node_title: a.node_title ?? a.node_id,
      summary: eventSummary(a.kind, a.payload),
    })),
  };
}

export function rollupHash(rollup: Rollup): string {
  return crypto.createHash('sha256').update(JSON.stringify(rollup)).digest('hex').slice(0, 8);
}

function issueLine(r: IssueRef): string {
  return `- ${r.title} — updated ${r.updated.slice(0, 10)}`;
}

export function renderStatusMd(rollup: Rollup, prose: string, generatedBy: string): string {
  const hash = rollupHash(rollup);
  const total = Object.values(rollup.counts).reduce((a, b) => a + b, 0);
  const lines: string[] = [
    '---',
    'derived: true',
    `project: ${rollup.project_id}`,
    `generated: ${nowIso()}`,
    `generated_by: ${generatedBy}`,
    `rollup_hash: ${hash}`,
    '---',
    '',
    '## Summary',
    '',
    prose.trim(),
    '',
  ];
  const section = (title: string, refs: IssueRef[], extra?: (r: IssueRef) => string) => {
    if (!refs.length) return;
    lines.push(`## ${title}`, '');
    for (const r of refs) lines.push(extra ? extra(r) : issueLine(r));
    lines.push('');
  };
  section('Now', rollup.now);
  if (rollup.blocked.length) {
    lines.push('## Blocked', '');
    for (const b of rollup.blocked) {
      const by = b.blocked_by.length ? ` (blocked by: ${b.blocked_by.map((x) => x.title).join(', ')})` : '';
      lines.push(`- ${b.title}${by}`);
    }
    lines.push('');
  }
  section('Recently done', rollup.recently_done);
  section('Stale', rollup.stale, (r) => `- ${r.title} — no activity since ${(r.last_activity ?? r.updated).slice(0, 10)}`);
  lines.push('## Counts', '', '| state | count |', '|---|---|');
  for (const [state, n] of Object.entries(rollup.counts).sort()) lines.push(`| ${state} | ${n} |`);
  lines.push(`| **total** | **${total}** |`, '');
  return lines.join('\n');
}

/** Write status.md for a project (the only code path allowed to touch it). */
export function writeStatus(ws: Workspace, projectId: string, prose: string, generatedBy: string): { path: string; hash: string } {
  const rollup = computeRollup(ws, projectId);
  const project = ws.requireRow(projectId);
  const rel = statusPath(project.slug as string);
  const absPath = path.join(ws.root, rel);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, renderStatusMd(rollup, prose, generatedBy), 'utf8');
  indexFile(ws.root, ws.db, rel);
  return { path: rel, hash: rollupHash(rollup) };
}
