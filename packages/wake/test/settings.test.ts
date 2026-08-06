import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../src/core/spaces.js';
import { buildHttpApp } from '../src/http/server.js';
import { loadSettings, DEFAULT_STATES } from '../src/core/settings.js';

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-settings-'));
  for (const d of ['projects', 'docs', 'artifacts', 'activity']) fs.mkdirSync(path.join(ws, d));
  return ws;
}

describe('workspace settings (wake.json)', () => {
  it('falls back to defaults without wake.json or with invalid json', () => {
    const root = tmpWs();
    expect(loadSettings(root).states).toEqual(DEFAULT_STATES);
    fs.writeFileSync(path.join(root, 'wake.json'), '{nope');
    expect(loadSettings(root).states).toEqual(DEFAULT_STATES);
  });

  it('overrides state labels and colors, keeping canonical keys', () => {
    const root = tmpWs();
    fs.writeFileSync(
      path.join(root, 'wake.json'),
      JSON.stringify({
        states: {
          'in-progress': { label: 'doing', hue: 300 },
          done: { label: 'shipped' },
          bogus: { label: 'ignored' },
        },
      }),
    );
    const { states } = loadSettings(root);
    expect(states['in-progress']).toEqual({ label: 'doing', hue: 300, chroma: 0.11 });
    expect(states.done.label).toBe('shipped');
    expect(states.triage).toEqual(DEFAULT_STATES.triage);
    expect((states as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('serves settings per space, live-reloading edits', async () => {
    const root = tmpWs();
    const hub = Hub.single(root);
    const slug = hub.spaces()[0].slug;
    const app = buildHttpApp(hub, {});
    const before = await app.request(`/api/s/${slug}/meta`).then((r) => r.json());
    expect(before.states.done.label).toBe('done');

    fs.writeFileSync(path.join(root, 'wake.json'), JSON.stringify({ states: { done: { label: 'shipped' } } }));
    const after = await app.request(`/api/s/${slug}/meta`).then((r) => r.json());
    expect(after.states.done.label).toBe('shipped');
    hub.closeAll();
  });
});
