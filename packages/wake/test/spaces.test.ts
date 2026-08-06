import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Hub, createSpace, listSpaces, migrateLegacyLayout, scaffoldSpace } from '../src/core/spaces.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { buildHttpApp } from '../src/http/server.js';
import { renderMarkdown } from '../src/core/markdown.js';

const opened: Hub[] = [];
afterEach(() => {
  for (const h of opened.splice(0)) h.closeAll();
});

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wake-home-'));
}

function track(hub: Hub): Hub {
  opened.push(hub);
  return hub;
}

async function connect(hub: Hub) {
  const server = buildMcpServer(hub);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      /* error results are plain text */
    }
    return { isError: !!res.isError, text, data };
  };
  return { client, call };
}

describe('spaces', () => {
  it('keeps each space isolated on disk and in the index', async () => {
    const home = tmpHome();
    createSpace(home, 'Work');
    createSpace(home, 'Side Project');
    const hub = track(Hub.open(home));

    expect(hub.spaces().map((s) => s.slug).sort()).toEqual(['side-project', 'work']);

    const work = hub.workspace('work');
    const side = hub.workspace('side-project');
    const wp = work.create({ type: 'project', title: 'Ledger' });
    const sp = side.create({ type: 'project', title: 'Garden' });

    expect(work.list({ type: 'project' }).map((p) => p.title)).toEqual(['Ledger']);
    expect(side.list({ type: 'project' }).map((p) => p.title)).toEqual(['Garden']);
    expect(work.nodeRow(sp.id)).toBeUndefined();
    expect(side.nodeRow(wp.id)).toBeUndefined();
    // separate git repos, separate indexes
    expect(fs.existsSync(path.join(home, 'spaces/work/.git'))).toBe(true);
    expect(fs.existsSync(path.join(home, 'spaces/side-project/.wake/index.db'))).toBe(true);
  });

  it('migrates a pre-spaces workspace, naming the space after its only project', () => {
    const home = tmpHome();
    const legacy = path.join(home, 'workspace');
    scaffoldSpace(legacy, 'workspace');
    const ws = Hub.single(legacy);
    ws.workspace(ws.spaces()[0].slug).create({ type: 'project', title: 'Wake' });
    ws.closeAll();

    const migrated = migrateLegacyLayout(home);
    expect(migrated?.slug).toBe('wake');
    expect(fs.existsSync(path.join(home, 'spaces/wake/projects/wake/project.md'))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);

    const hub = track(Hub.open(home));
    expect(hub.workspace('wake').list({ type: 'project' })[0].title).toBe('Wake');
    // running it again is a no-op
    expect(migrateLegacyLayout(home)).toBeUndefined();
  });

  it('lets an agent reach every space through one endpoint', async () => {
    const home = tmpHome();
    createSpace(home, 'Work');
    createSpace(home, 'Personal');
    const hub = track(Hub.open(home));
    const { call } = await connect(hub);

    const spaces = await call('list_spaces');
    expect((spaces.data.spaces as { slug: string }[]).map((s) => s.slug).sort()).toEqual(['personal', 'work']);

    // creating requires naming the space when several are reachable
    const ambiguous = await call('create_node', { type: 'project', title: 'Nope' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toMatch(/pass 'space'/);

    const project = await call('create_node', { type: 'project', title: 'Ledger', space: 'work' });
    expect(project.data.space).toBe('work');

    // an issue lands in its project's space without naming it again
    const issue = await call('create_node', {
      type: 'issue',
      title: 'Reconcile March',
      project_id: project.data.id as string,
    });
    expect(issue.data.space).toBe('work');

    // id-addressed tools find the right space by themselves
    const fetched = await call('get_node', { id: issue.data.id as string });
    expect(fetched.data.space).toBe('work');
    const moved = await call('set_issue_state', {
      id: issue.data.id as string,
      state: 'in-progress',
      reason: 'starting',
    });
    expect(moved.data).toMatchObject({ from: 'triage', to: 'in-progress' });

    // search spans every space unless told otherwise
    await call('create_node', { type: 'doc', title: 'Ledger notes', space: 'personal', body: 'reconcile ideas' });
    const all = await call('search', { query: 'reconcile' });
    expect(new Set((all.data.results as { space: string }[]).map((r) => r.space))).toEqual(
      new Set(['work', 'personal']),
    );
    const scoped = await call('search', { query: 'reconcile', space: 'personal' });
    expect((scoped.data.results as { space: string }[]).every((r) => r.space === 'personal')).toBe(true);
  });

  it('scopes an agent to one space structurally', async () => {
    const home = tmpHome();
    createSpace(home, 'Work');
    createSpace(home, 'Secret');
    const hub = track(Hub.open(home));
    hub.workspace('secret').create({ type: 'project', title: 'Hidden Thing' });

    const { call } = await connect(hub.scopedTo('work'));
    const spaces = await call('list_spaces');
    expect((spaces.data.spaces as { slug: string }[]).map((s) => s.slug)).toEqual(['work']);

    const leak = await call('search', { query: 'hidden' });
    expect(leak.data.results).toEqual([]);

    const reach = await call('create_node', { type: 'project', title: 'X', space: 'secret' });
    expect(reach.isError).toBe(true);
  });

  it('serves per-space HTTP and refuses another space to a scoped token', async () => {
    const home = tmpHome();
    createSpace(home, 'Work');
    createSpace(home, 'Secret');
    const hub = track(Hub.open(home));
    hub.workspace('work').create({ type: 'project', title: 'Ledger' });
    hub.workspace('secret').create({ type: 'project', title: 'Hidden Thing' });

    process.env.WAKE_TOKEN_WORK = 'work-only';
    try {
      const app = buildHttpApp(hub, { token: 'user-token' });

      const me = await app.request('/api/me', { headers: { Authorization: 'Bearer user-token' } }).then((r) => r.json());
      expect(me.spaces.map((s: { slug: string }) => s.slug).sort()).toEqual(['secret', 'work']);

      const scopedList = await app
        .request('/api/spaces', { headers: { Authorization: 'Bearer work-only' } })
        .then((r) => r.json());
      expect(scopedList.spaces.map((s: { slug: string }) => s.slug)).toEqual(['work']);

      const denied = await app.request('/api/s/secret/home', { headers: { Authorization: 'Bearer work-only' } });
      expect(denied.status).toBe(404);

      const allowed = await app.request('/api/s/work/home', { headers: { Authorization: 'Bearer work-only' } });
      expect(allowed.status).toBe(200);

      expect((await app.request('/api/s/work/home')).status).toBe(401);
    } finally {
      delete process.env.WAKE_TOKEN_WORK;
    }
  });

  it('scopes UI links to their space', () => {
    const home = tmpHome();
    createSpace(home, 'Work');
    const hub = track(Hub.open(home));
    const ws = hub.workspace('work');
    const project = ws.create({ type: 'project', title: 'Ledger' });
    ws.create({ type: 'doc', title: 'Notes', body: `see [[Ledger]]`, doc_path: 'notes' });
    expect(listSpaces(home)).toHaveLength(1);

    const html = renderMarkdown(ws, 'see [[Ledger]]');
    expect(html).toContain('/s/work/p/ledger');
    expect(project.id).toBeTruthy();
  });
});
