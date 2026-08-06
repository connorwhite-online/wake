import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendActivity,
  assertPatchAllowed,
  loadNode,
  parseNodeFile,
  readActivity,
  saveNode,
  serializeNode,
} from '../src/core/store.js';
import type { IssueFrontmatter } from '../src/core/schema.js';

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wake-test-'));
}

const issueFm: IssueFrontmatter = {
  id: '01J4Y0FQ7ZP8N2K5V9W3X6B1M4',
  type: 'issue',
  title: 'Test issue',
  state: 'todo',
  project: '01J4XW5B8QK2M9T3G7H1R2C3D4',
  created: '2026-08-01T10:00:00.000Z',
  updated: '2026-08-02T10:00:00.000Z',
  author: 'claude-code',
  tags: ['test'],
  links: [{ to: '01J4XX9C2D4E6F8G0H1J2K3L4M', type: 'relates-to' }],
  space: 'home',
  archived: false,
};

describe('store', () => {
  it('round-trips a node through serialize/parse', () => {
    const raw = serializeNode(issueFm, 'Description **here**.\n');
    const node = parseNodeFile(raw, 'projects/x/issues/a.md');
    expect(node.fm).toEqual(issueFm);
    expect(node.body.trim()).toBe('Description **here**.');
  });

  it('round-trips through the filesystem (YAML date coercion)', () => {
    const ws = tmpWs();
    saveNode(ws, 'projects/x/issues/a.md', issueFm, 'body');
    const node = loadNode(ws, 'projects/x/issues/a.md');
    expect(node.fm.created).toBe(issueFm.created);
    expect((node.fm as IssueFrontmatter).state).toBe('todo');
  });

  it('rejects patches to protected fields with actionable messages', () => {
    expect(() => assertPatchAllowed({ title: 'ok' })).not.toThrow();
    expect(() => assertPatchAllowed({ state: 'done' })).toThrow(/set_issue_state/);
    expect(() => assertPatchAllowed({ links: [] })).toThrow(/link tool/);
    expect(() => assertPatchAllowed({ id: 'x' })).toThrow(/read-only/);
    expect(() => assertPatchAllowed({ updated: 'x' })).toThrow(/server-managed/);
  });

  it('appends and tails NDJSON activity, skipping malformed lines', () => {
    const ws = tmpWs();
    const rel = 'projects/x/activity.ndjson';
    appendActivity(ws, rel, {
      ts: '2026-08-01T10:00:00.000Z',
      actor: 'connor',
      node: 'n1',
      kind: 'note',
      payload: { text: 'hello' },
    });
    fs.appendFileSync(path.join(ws, rel), 'not json\n');
    appendActivity(ws, rel, {
      ts: '2026-08-02T10:00:00.000Z',
      actor: 'claude-code',
      node: 'n1',
      kind: 'note',
      payload: { text: 'world' },
    });
    const all = readActivity(ws, rel);
    expect(all.totalLines).toBe(3);
    expect(all.events).toHaveLength(2);
    const fromOffset = readActivity(ws, rel, 1);
    expect(fromOffset.events).toHaveLength(1);
    expect(fromOffset.events[0].event.payload.text).toBe('world');
  });
});
