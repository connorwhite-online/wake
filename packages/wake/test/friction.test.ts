import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/core/workspace.js';
import { computeRollup } from '../src/core/rollup.js';

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-friction-'));
  for (const d of ['projects', 'docs', 'artifacts', 'activity']) fs.mkdirSync(path.join(ws, d));
  return ws;
}

describe('friction-log fixes', () => {
  it('archive hides a node from list, search, and rollup; unarchive restores it', () => {
    const root = tmpWs();
    const ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'P' });
    const issue = ws.create({ type: 'issue', title: 'Zanzibar experiment', project_id: project.id });

    expect(ws.list({ type: 'issue' })).toHaveLength(1);
    expect(computeRollup(ws, project.id).counts['triage']).toBe(1);

    ws.setArchived(issue.id, true, 'exploratory, superseded');
    expect(ws.list({ type: 'issue' })).toHaveLength(0);
    expect(ws.list({ type: 'issue', include_archived: true })).toHaveLength(1);
    expect(ws.search({ query: 'zanzibar' })).toHaveLength(0);
    expect(ws.search({ query: 'zanzibar', include_archived: true })).toHaveLength(1);
    expect(computeRollup(ws, project.id).counts['triage']).toBeUndefined();

    // archived survives on disk and is reversible with history
    expect(() => ws.setArchived(issue.id, true, 'again')).toThrow(/already archived/);
    ws.setArchived(issue.id, false, 'actually still relevant');
    expect(ws.list({ type: 'issue' })).toHaveLength(1);
    const kinds = ws.activityFor(issue.id).map((e) => e.kind);
    expect(kinds).toContain('archived');
    expect(kinds).toContain('unarchived');

    // and the flag is protected from update_node
    expect(() => ws.update(issue.id, { archived: true })).toThrow(/archive_node/);
    ws.close();
  });

  it('issues can be created directly into a non-triage state', () => {
    const root = tmpWs();
    const ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'P' });
    const issue = ws.create({ type: 'issue', title: 'Already underway', project_id: project.id, state: 'in-progress' });
    expect(ws.summary(issue.id)?.state).toBe('in-progress');
    const created = ws.activityFor(issue.id).find((e) => e.kind === 'created');
    expect(created?.payload.state).toBe('in-progress');
    ws.close();
  });

  it('rejects a no-op state transition', () => {
    const root = tmpWs();
    const ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'P' });
    const issue = ws.create({ type: 'issue', title: 'I', project_id: project.id });
    expect(() => ws.setIssueState(issue.id, 'triage', 'noop')).toThrow(/already/);
    ws.close();
  });

  it('write_doc with expect_updated fails loudly on concurrent change', () => {
    const root = tmpWs();
    const ws = Workspace.open(root);
    const doc = ws.writeDoc('guides/x', 'v1');
    const staleTimestamp = ws.summary(doc.id)!.updated;
    ws.appendDoc(doc.id, 'More', 'grew in the meantime');
    expect(() => ws.writeDoc('guides/x', 'v2', undefined, 'agent', staleTimestamp)).toThrow(/changed since/);
    const fresh = ws.summary(doc.id)!.updated;
    expect(ws.writeDoc('guides/x', 'v2', undefined, 'agent', fresh).id).toBe(doc.id);
    ws.close();
  });

  it('search snippets escape workspace HTML and mark matches safely', () => {
    const root = tmpWs();
    const ws = Workspace.open(root);
    ws.create({ type: 'doc', title: 'XSS bait', body: 'evil <script>alert(1)</script> flamingo text', doc_path: 'bait' });
    const [hit] = ws.search({ query: 'flamingo' });
    expect(hit.snippet).toContain('**flamingo**');
    expect(hit.snippet_html).toContain('<b>flamingo</b>');
    expect(hit.snippet_html).not.toContain('<script>');
    ws.close();
  });

  it('projectLastActive reflects child issue activity', () => {
    const root = tmpWs();
    const ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'P' });
    const before = ws.projectLastActive(project.id);
    const issue = ws.create({ type: 'issue', title: 'I', project_id: project.id });
    ws.logActivity(issue.id, 'still moving');
    const after = ws.projectLastActive(project.id);
    expect(after).not.toBeNull();
    expect(after! >= before!).toBe(true);
    const lastEvent = ws.activityFor(issue.id, 1)[0];
    expect(after).toBe(lastEvent.ts);
    ws.close();
  });
});
