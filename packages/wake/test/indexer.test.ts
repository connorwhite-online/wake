import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/core/workspace.js';

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-idx-'));
  for (const d of ['projects', 'docs', 'artifacts', 'activity']) fs.mkdirSync(path.join(ws, d));
  return ws;
}

function counts(ws: Workspace) {
  return {
    nodes: (ws.db.prepare('SELECT COUNT(*) c FROM nodes').get() as { c: number }).c,
    edges: (ws.db.prepare('SELECT COUNT(*) c FROM edges').get() as { c: number }).c,
    activity: (ws.db.prepare('SELECT COUNT(*) c FROM activity').get() as { c: number }).c,
  };
}

describe('indexer + workspace', () => {
  it('indexes created nodes, edges, activity; search finds them', () => {
    const root = tmpWs();
    const ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'Test Project', actor: 'connor' });
    const issue = ws.create({ type: 'issue', title: 'Fix the flux capacitor', project_id: project.id });
    const doc = ws.create({ type: 'doc', title: 'Flux Notes', body: 'See [[Fix the flux capacitor]].', doc_path: 'notes/flux' });
    ws.addLink(doc.id, issue.id, 'documents');

    expect(counts(ws).nodes).toBe(3);
    const hits = ws.search({ query: 'flux capacitor' });
    expect(hits.some((h) => h.id === issue.id)).toBe(true);

    const backlinks = ws.backlinks(issue.id);
    const kinds = backlinks.map((b) => b.kind).sort();
    expect(kinds).toContain('documents');
    expect(kinds).toContain('references'); // via the wiki link

    const events = ws.activityFor(issue.id);
    expect(events.some((e) => e.kind === 'created')).toBe(true);
    ws.close();
  });

  it('survives index deletion — rebuild yields identical contents', () => {
    const root = tmpWs();
    let ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'P' });
    const issue = ws.create({ type: 'issue', title: 'I', project_id: project.id });
    ws.setIssueState(issue.id, 'in-progress', 'starting');
    const before = counts(ws);
    ws.close();

    fs.rmSync(path.join(root, '.wake'), { recursive: true });
    ws = Workspace.open(root);
    expect(counts(ws)).toEqual(before);
    expect(ws.summary(issue.id)?.state).toBe('in-progress');
    ws.close();
  });

  it('catches up on files changed outside the process', () => {
    const root = tmpWs();
    let ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'P' });
    const issue = ws.create({ type: 'issue', title: 'Old title', project_id: project.id });
    const issuePath = path.join(root, ws.nodeRow(issue.id)!.path as string);
    ws.close();

    // simulate a raw agent edit (no MCP): rewrite title, ensure mtime moves
    const raw = fs.readFileSync(issuePath, 'utf8').replace('Old title', 'New title');
    fs.writeFileSync(issuePath, raw);
    const future = Date.now() + 2000;
    fs.utimesSync(issuePath, new Date(future), new Date(future));

    ws = Workspace.open(root); // catchUp scan runs here
    expect(ws.summary(issue.id)?.title).toBe('New title');
    ws.close();
  });

  it('rejects protected-field patches through update()', () => {
    const root = tmpWs();
    const ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'P' });
    const issue = ws.create({ type: 'issue', title: 'I', project_id: project.id });
    expect(() => ws.update(issue.id, { state: 'done' })).toThrow(/set_issue_state/);
    expect(ws.update(issue.id, { title: 'I2' }).title).toBe('I2');
    ws.close();
  });
});
