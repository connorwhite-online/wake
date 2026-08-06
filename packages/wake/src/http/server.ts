import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { serve, type HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import { Workspace } from '../core/workspace.js';
import { startWatcher } from '../core/watcher.js';
import { startGitSync } from '../core/gitsync.js';
import { buildApi } from './api.js';
import { McpHttpEndpoint } from './mcp-http.js';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Streamable HTTP responses are written straight to the Node response object.
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';

function findUiDist(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../ui/dist'),
    path.resolve(here, '../../../../ui/dist'),
    path.resolve(here, '../../ui/dist'),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'index.html')));
}

export interface HttpAppOptions {
  bus?: EventEmitter;
  /** bearer token; when set, /api and /mcp require it */
  token?: string;
  uiDist?: string;
}

export function buildHttpApp(ws: Workspace, opts: HttpAppOptions = {}): Hono<{ Bindings: HttpBindings }> {
  const bus = opts.bus ?? new EventEmitter();
  const token = opts.token ?? process.env.WAKE_TOKEN;
  const app = new Hono<{ Bindings: HttpBindings }>();
  const mcp = new McpHttpEndpoint(ws);

  const authorized = (c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }) => {
    if (!token) return true;
    const header = c.req.header('authorization');
    if (header === `Bearer ${token}`) return true;
    // query fallback for browser-native fetches (artifact links)
    return c.req.query('token') === token;
  };

  app.use('/api/*', async (c, next) => {
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.all('/mcp', async (c) => {
    if (!authorized(c)) {
      return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null }, 401);
    }
    const body = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
    await mcp.handle(c.env.incoming, c.env.outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });

  app.route('/', buildApi(ws, bus));

  const uiDist = opts.uiDist ?? findUiDist();
  if (uiDist) {
    app.get('*', (c) => {
      const reqPath = decodeURIComponent(new URL(c.req.url).pathname);
      const safe = path.posix.normalize(reqPath).replace(/^(\.\.\/?)+/, '');
      let file = path.join(uiDist, safe);
      if (!file.startsWith(uiDist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(uiDist, 'index.html'); // SPA fallback
      }
      return c.body(fs.readFileSync(file), 200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      });
    });
  } else {
    app.get('/', (c) =>
      c.text('wake API is running. UI not built — run `npm run build -w packages/ui`, or `npm run dev -w packages/ui` for the dev server.'),
    );
  }

  return app;
}

export async function runHttpServer(wsRoot: string, port: number): Promise<void> {
  const ws = Workspace.open(wsRoot);
  const bus = new EventEmitter();
  const gitSync = process.env.WAKE_GIT_SYNC === '1' ? startGitSync(wsRoot) : undefined;
  startWatcher(ws, (rel) => {
    bus.emit('change', rel);
    gitSync?.touch();
  });

  const app = buildHttpApp(ws, { bus });
  const token = process.env.WAKE_TOKEN;

  serve({ fetch: app.fetch, port, hostname: process.env.WAKE_HOST || undefined }, () => {
    console.log(`wake reading ui + api on http://localhost:${port} (workspace: ${wsRoot})`);
    console.log(`wake mcp (streamable http) on http://localhost:${port}/mcp${token ? ' [token required]' : ''}`);
    if (!token) {
      console.log('note: WAKE_TOKEN is not set — anyone who can reach this port can read and write. Fine on localhost; set it before exposing to a network.');
    }
    if (gitSync) console.log(`git sync enabled${process.env.WAKE_GIT_PUSH === '1' ? ' (with push)' : ''}`);
  });
}
