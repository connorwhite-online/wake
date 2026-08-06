import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Hub } from '../src/core/spaces.js';
import type { Workspace } from '../src/core/workspace.js';
import { buildMcpServer } from '../src/mcp/server.js';

let hub: Hub;
let ws: Workspace;
let client: Client;
let root: string;

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
  return { isError: !!res.isError, text, data: safeParse(text) };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-mcp-'));
  for (const d of ['projects', 'docs', 'artifacts', 'activity']) fs.mkdirSync(path.join(root, d));
  hub = Hub.single(root);
  ws = hub.workspace(hub.spaces()[0].slug);
  const server = buildMcpServer(hub);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-agent', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(() => hub.closeAll());

describe('wake mcp server', () => {
  it('drives the full create → search → state → activity loop', async () => {
    const project = await call('create_node', { type: 'project', title: 'Rocket', actor: 'claude-code' });
    expect(project.isError).toBe(false);
    const projectId = project.data.id as string;

    const issue = await call('create_node', {
      type: 'issue',
      title: 'Ignition sequence flaky on cold boots',
      project_id: projectId,
      body: 'Fails roughly 1 in 5 launches.',
      actor: 'claude-code',
    });
    const issueId = issue.data.id as string;

    const found = await call('search', { query: 'ignition flaky' });
    expect((found.data.results as { id: string }[]).some((r) => r.id === issueId)).toBe(true);

    const transition = await call('set_issue_state', {
      id: issueId,
      state: 'in-progress',
      reason: 'reproducing locally',
      actor: 'claude-code',
    });
    expect(transition.data).toMatchObject({ from: 'triage', to: 'in-progress' });

    await call('log_activity', { node_id: issueId, text: 'bisected to timing race in warmup', actor: 'claude-code' });

    const node = await call('get_node', { id: issueId });
    expect(node.data.state).toBe('in-progress');
    const kinds = (node.data.activity as { kind: string }[]).map((a) => a.kind);
    expect(kinds).toContain('created');
    expect(kinds).toContain('state_changed');
    expect(kinds).toContain('note');
  });

  it('rejects patches to derived fields with a pointer to the right tool', async () => {
    const projects = await call('list', { type: 'project' });
    const projectId = (projects.data.nodes as { id: string }[])[0].id;
    const issue = await call('create_node', { type: 'issue', title: 'Guard test', project_id: projectId });
    const res = await call('update_node', { id: issue.data.id as string, patch: { state: 'done' } });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/set_issue_state/);
  });

  it('runs the regenerate_status two-call handshake, detecting staleness', async () => {
    const projects = await call('list', { type: 'project' });
    const projectId = (projects.data.nodes as { id: string }[])[0].id;

    const first = await call('regenerate_status', { project_id: projectId });
    expect(first.data.rollup_hash).toBeTruthy();
    expect(first.data.instructions).toMatch(/prose/);

    // mutate the project between the two calls → the hash must go stale
    await call('create_node', { type: 'issue', title: 'Sneaky new work', project_id: projectId });
    const stale = await call('regenerate_status', {
      project_id: projectId,
      prose: 'Everything is fine.',
      rollup_hash: first.data.rollup_hash,
    });
    expect(stale.data.stale).toBe(true);

    const second = await call('regenerate_status', {
      project_id: projectId,
      prose: 'Ignition work is in progress; one new issue just landed in triage.',
      rollup_hash: stale.data.rollup_hash,
      actor: 'claude-code',
    });
    expect(second.data.ok).toBe(true);

    const statusRaw = fs.readFileSync(path.join(root, second.data.path as string), 'utf8');
    expect(statusRaw).toContain('derived: true');
    expect(statusRaw).toContain('## Summary');
    expect(statusRaw).toContain('Ignition work is in progress');
  });

  it('writes and appends docs, resolving them in search and resources', async () => {
    const doc = await call('write_doc', {
      path: 'guides/launch-checklist',
      title: 'Launch Checklist',
      content: '## Before\n\n- fuel\n\n## After\n\n- telemetry review',
      actor: 'claude-code',
    });
    expect(doc.isError).toBe(false);
    await call('append_doc', { id: doc.data.id as string, section: 'Before', content: '- weather hold criteria' });
    const node = await call('get_node', { id: doc.data.id as string });
    const body = node.data.body as string;
    expect(body.indexOf('weather hold')).toBeGreaterThan(body.indexOf('## Before'));
    expect(body.indexOf('weather hold')).toBeLessThan(body.indexOf('## After'));

    const resource = await client.readResource({ uri: `wake://s/${ws.slug}/docs/guides/launch-checklist` });
    expect((resource.contents[0] as { text: string }).text).toContain('weather hold');
  });

  it('refuses doc writes outside docs/', async () => {
    const res = await call('write_doc', { path: '../projects/rocket/status', content: 'nope' });
    expect(res.isError).toBe(true);
  });
});
