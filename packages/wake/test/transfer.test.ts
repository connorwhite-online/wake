import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyFiles, collectSpaceFiles, isNewer, mergeNdjson, safeRelative } from '../src/core/transfer.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wake-transfer-'));
}

function write(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('space transfer', () => {
  it('collects the record and leaves derived state behind', () => {
    const root = tmpDir();
    write(root, 'space.json', '{}');
    write(root, 'projects/wake/project.md', '# project');
    write(root, 'projects/wake/issues/A.md', '# issue');
    write(root, 'projects/wake/issues/A.ndjson', '{}');
    write(root, '.wake/index.db', 'binary');
    write(root, '.git/config', '[core]');

    const files = collectSpaceFiles(root).map((f) => f.path);
    expect(files).toEqual([
      'projects/wake/issues/A.md',
      'projects/wake/issues/A.ndjson',
      'projects/wake/project.md',
      'space.json',
    ]);
  });

  it('refuses to write outside the space', () => {
    const root = tmpDir();
    for (const evil of ['../escape.md', 'a/../../escape.md', '/etc/passwd', '.git/config', '.wake/index.db']) {
      expect(safeRelative(root, evil)).toBeNull();
    }
    expect(safeRelative(root, 'projects/wake/issues/A.md')).toBe(
      path.join(root, 'projects/wake/issues/A.md'),
    );
  });

  it('reports rejected paths instead of silently dropping them', () => {
    const root = tmpDir();
    const result = applyFiles(root, [
      { path: 'ok.md', content: 'fine' },
      { path: '../escape.md', content: 'nope' },
    ]);
    expect(result.written).toEqual(['ok.md']);
    expect(result.rejected).toEqual(['../escape.md']);
    expect(fs.existsSync(path.join(path.dirname(root), 'escape.md'))).toBe(false);
  });

  it('is additive by default — an unstamped live copy wins', () => {
    const root = tmpDir();
    write(root, 'projects/wake/project.md', 'live version');

    const result = applyFiles(root, [
      { path: 'projects/wake/project.md', content: 'incoming version' },
      { path: 'projects/wake/issues/NEW.md', content: 'new issue' },
    ]);

    expect(result.written).toEqual(['projects/wake/issues/NEW.md']);
    expect(result.skipped).toEqual(['projects/wake/project.md']);
    expect(fs.readFileSync(path.join(root, 'projects/wake/project.md'), 'utf8')).toBe('live version');
  });

  const stamped = (updated: string, body: string) =>
    `---\nid: X\nupdated: '${updated}'\n---\n\n${body}\n`;

  it('takes the newer copy of a node, in either direction', () => {
    const root = tmpDir();
    write(root, 'a.md', stamped('2026-01-01T00:00:00.000Z', 'old status'));
    write(root, 'b.md', stamped('2026-06-01T00:00:00.000Z', 'live is newer'));

    const result = applyFiles(root, [
      { path: 'a.md', content: stamped('2026-02-01T00:00:00.000Z', 'fresh status') },
      { path: 'b.md', content: stamped('2026-01-01T00:00:00.000Z', 'incoming is older') },
    ]);

    expect(result.written).toEqual(['a.md']);
    expect(result.skipped).toEqual(['b.md']);
    expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toContain('fresh status');
    expect(fs.readFileSync(path.join(root, 'b.md'), 'utf8')).toContain('live is newer');
  });

  it('refreshes a derived status.md, which stamps generated not updated', () => {
    // the exact miss that left a deployment showing month-old status prose
    const root = tmpDir();
    write(root, 'projects/w/status.md', '---\nderived: true\ngenerated: 2026-08-06T07:26:12.421Z\n---\n\nold prose\n');

    const result = applyFiles(root, [
      {
        path: 'projects/w/status.md',
        content: '---\nderived: true\ngenerated: 2026-08-07T04:44:59.735Z\n---\n\nnew prose\n',
      },
    ]);

    expect(result.written).toEqual(['projects/w/status.md']);
    expect(fs.readFileSync(path.join(root, 'projects/w/status.md'), 'utf8')).toContain('new prose');
  });

  it('will not take an unstamped file over a stamped one', () => {
    const root = tmpDir();
    write(root, 'a.md', stamped('2026-01-01T00:00:00.000Z', 'real node'));
    const result = applyFiles(root, [{ path: 'a.md', content: 'no frontmatter at all' }]);
    expect(result.skipped).toEqual(['a.md']);
    expect(isNewer('no frontmatter', stamped('2026-01-01T00:00:00.000Z', 'x'))).toBe(false);
  });

  it('overwrites only when asked, and not when the bytes already match', () => {
    const root = tmpDir();
    write(root, 'a.md', 'old');
    write(root, 'b.md', 'same');

    const result = applyFiles(
      root,
      [
        { path: 'a.md', content: 'new' },
        { path: 'b.md', content: 'same' },
      ],
      true,
    );

    expect(result.written).toEqual(['a.md']);
    expect(result.skipped).toEqual(['b.md']);
    expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('new');
  });

  it('merges append-only logs instead of skipping them', () => {
    const a = '{"ts":"2026-01-01T00:00:00Z","text":"one"}\n{"ts":"2026-01-03T00:00:00Z","text":"three"}';
    const b = '{"ts":"2026-01-02T00:00:00Z","text":"two"}\n{"ts":"2026-01-03T00:00:00Z","text":"three"}';

    const merged = mergeNdjson(a, b);
    expect(merged).not.toBeNull();
    const texts = merged!.trim().split('\n').map((l) => JSON.parse(l).text);
    // union, in time order, with the shared event counted once
    expect(texts).toEqual(['one', 'two', 'three']);

    // nothing new to add reads as untouched, not as a rewrite
    expect(mergeNdjson(a, a)).toBeNull();
    expect(mergeNdjson(a, '')).toBeNull();
  });

  it('merges logs through applyFiles even without --overwrite', () => {
    const root = tmpDir();
    write(root, 'activity/log.ndjson', '{"ts":"2026-01-01T00:00:00Z","text":"old"}\n');

    const result = applyFiles(root, [
      { path: 'activity/log.ndjson', content: '{"ts":"2026-01-02T00:00:00Z","text":"new"}\n' },
    ]);

    expect(result.written).toEqual(['activity/log.ndjson']);
    const lines = fs.readFileSync(path.join(root, 'activity/log.ndjson'), 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).text)).toEqual(['old', 'new']);
  });

  it('round-trips a whole space into an empty one', () => {
    const from = tmpDir();
    write(from, 'space.json', '{"name":"Wake"}');
    write(from, 'docs/decisions/001.md', '# adr');
    write(from, 'projects/wake/issues/A.md', '# issue');

    const to = tmpDir();
    const result = applyFiles(to, collectSpaceFiles(from));

    expect(result.rejected).toEqual([]);
    expect(collectSpaceFiles(to)).toEqual(collectSpaceFiles(from));
  });
});
