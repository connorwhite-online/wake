import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/core/workspace.js';
import { computeRollup, renderStatusMd, rollupHash } from '../src/core/rollup.js';
import { saveNode, appendActivity } from '../src/core/store.js';
import { issuePath, issueActivityPath } from '../src/core/paths.js';
import { newId } from '../src/core/ids.js';

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-rollup-'));
  for (const d of ['projects', 'docs', 'artifacts', 'activity']) fs.mkdirSync(path.join(ws, d));
  return ws;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

describe('rollup', () => {
  it('computes counts, stale, blocked, and a stable hash', () => {
    const root = tmpWs();
    let ws = Workspace.open(root);
    const project = ws.create({ type: 'project', title: 'Rollup P' });

    const fresh = ws.create({ type: 'issue', title: 'Fresh work', project_id: project.id });
    ws.setIssueState(fresh.id, 'in-progress', 'go');

    const blocked = ws.create({ type: 'issue', title: 'Waiting on fresh', project_id: project.id });
    ws.setIssueState(blocked.id, 'blocked', 'needs fresh work first');
    ws.addLink(fresh.id, blocked.id, 'blocks');
    ws.close();

    // hand-write a stale in-progress issue (20 days old, no recent activity)
    const staleId = newId();
    const created = daysAgo(20);
    saveNode(root, issuePath('rollup-p', staleId), {
      id: staleId,
      type: 'issue',
      title: 'Forgotten work',
      state: 'in-progress',
      project: project.id,
      created,
      updated: created,
      author: 'connor',
      tags: [],
      links: [],
      space: 'home',
    }, '');
    appendActivity(root, issueActivityPath('rollup-p', staleId), {
      ts: created,
      actor: 'connor',
      node: staleId,
      kind: 'created',
      payload: {},
    });

    ws = Workspace.open(root);
    const rollup = computeRollup(ws, project.id);
    expect(rollup.counts['in-progress']).toBe(2);
    expect(rollup.counts['blocked']).toBe(1);
    expect(rollup.stale.map((s) => s.id)).toEqual([staleId]);
    expect(rollup.blocked[0].blocked_by.map((b) => b.id)).toEqual([fresh.id]);

    // hash is deterministic for the same day
    expect(rollupHash(rollup)).toBe(rollupHash(computeRollup(ws, project.id)));

    const md = renderStatusMd(rollup, 'Two streams in flight; one is stale.', 'claude-code');
    expect(md).toContain('derived: true');
    expect(md).toContain('## Stale');
    expect(md).toContain('Forgotten work');
    expect(md).toContain('blocked by: Fresh work');
    expect(md).toMatch(/\| in-progress \| 2 \|/);
    ws.close();
  });
});
