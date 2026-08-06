import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Workspace } from '../src/core/workspace.js';
import { buildHttpApp } from '../src/http/server.js';

const TOKEN = 'test-secret';
let ws: Workspace;
let server: ServerType;
let base: string;

beforeAll(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-http-'));
  for (const d of ['projects', 'docs', 'artifacts', 'activity']) fs.mkdirSync(path.join(root, d));
  ws = Workspace.open(root);
  const app = buildHttpApp(ws, { token: TOKEN });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      base = `http://localhost:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  ws.close();
});

describe('wake over streamable http', () => {
  it('rejects unauthenticated mcp and api requests', async () => {
    const mcpRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(mcpRes.status).toBe(401);
    const apiRes = await fetch(`${base}/api/home`);
    expect(apiRes.status).toBe(401);
  });

  it('runs a full remote write loop: connect, create, read back over api', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'remote-agent', version: '0.0.0' });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('regenerate_status');

    const project = JSON.parse(
      ((await client.callTool({ name: 'create_node', arguments: { type: 'project', title: 'Cloud Project', actor: 'remote-agent' } }))
        .content as { text: string }[])[0].text,
    );
    const issue = JSON.parse(
      ((await client.callTool({
        name: 'create_node',
        arguments: { type: 'issue', title: 'Written from the internet', project_id: project.id, state: 'in-progress', actor: 'remote-agent' },
      })).content as { text: string }[])[0].text,
    );
    expect(issue.id).toBeTruthy();

    // the reading API sees the write immediately (same process, write-through index)
    const home = await fetch(`${base}/api/home`, { headers: { Authorization: `Bearer ${TOKEN}` } }).then((r) => r.json());
    expect(home.projects.some((p: { id: string }) => p.id === project.id)).toBe(true);
    const search = await fetch(`${base}/api/search?q=internet`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }).then((r) => r.json());
    expect(search.results.some((r: { id: string }) => r.id === issue.id)).toBe(true);

    await client.close();
  });

  it('accepts the token as a query param for browser-native fetches', async () => {
    const res = await fetch(`${base}/api/home?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });
});
