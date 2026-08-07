import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { serve, type HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Hono } from 'hono';
import type { Hub } from '../core/spaces.js';
import { startWatcher } from '../core/watcher.js';
import { startGitSync } from '../core/gitsync.js';
import { buildApi } from './api.js';
import { buildOAuth, publicOrigin } from './oauth.js';
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

function findUiDist(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../ui/dist'),
    path.resolve(here, '../../../../ui/dist'),
    path.resolve(here, '../../ui/dist'),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'index.html')));
}

/** '*' = every space; otherwise the single space slug this caller may reach. */
type Grant = '*' | string | null;

function envTokenFor(slug: string): string | undefined {
  return process.env[`WAKE_TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
}

export interface HttpAppOptions {
  bus?: EventEmitter;
  /** bearer token granting every space; when unset and no per-space tokens exist, access is open */
  token?: string;
  uiDist?: string;
}

export function buildHttpApp(hub: Hub, opts: HttpAppOptions = {}): Hono<{ Bindings: HttpBindings }> {
  const bus = opts.bus ?? new EventEmitter();
  const token = opts.token ?? process.env.WAKE_TOKEN;
  const app = new Hono<{ Bindings: HttpBindings }>();

  // one API + MCP endpoint per grant scope; a scoped grant gets a hub that
  // literally contains only its space, so isolation is structural
  const apis = new Map<string, Hono>();
  const apiFor = (scope: string): Hono => {
    let api = apis.get(scope);
    if (!api) {
      api = buildApi(scope === '*' ? hub : hub.scopedTo(scope), bus);
      apis.set(scope, api);
    }
    return api;
  };
  const endpoints = new Map<string, McpHttpEndpoint>();
  const endpointFor = (scope: string): McpHttpEndpoint => {
    let ep = endpoints.get(scope);
    if (!ep) {
      ep = new McpHttpEndpoint(scope === '*' ? hub : hub.scopedTo(scope));
      endpoints.set(scope, ep);
    }
    return ep;
  };

  const spaceTokens = () => hub.spaces().map((s) => [s.slug, envTokenFor(s.slug)] as const).filter(([, t]) => !!t);

  // OAuth 2.1, for the Claude apps' connector flow (no static-token path there).
  // Its tokens resolve to the same grants as static ones.
  const { app: oauthApp, provider: oauth } = buildOAuth(hub, token);
  app.route('/', oauthApp);

  /** Resolve a presented bearer token to what it may reach. */
  const grantFor = (presented: string | undefined): Grant => {
    const scoped = spaceTokens();
    if (!token && scoped.length === 0) return '*'; // no auth configured (localhost dev)
    if (presented && token && presented === token) return '*';
    const match = scoped.find(([, t]) => t === presented);
    if (match) return match[0];
    return presented ? oauth.validate(presented) : null;
  };

  /** RFC 9728: point an unauthorized client at the metadata that starts OAuth. */
  const challenge = (req: Request) =>
    `Bearer resource_metadata="${publicOrigin(req)}/.well-known/oauth-protected-resource"`;

  const presentedToken = (c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }) => {
    const header = c.req.header('authorization');
    if (header?.startsWith('Bearer ')) return header.slice(7);
    // query fallback for browser-native fetches (artifact links)
    return c.req.query('token');
  };

  app.all('/mcp', async (c) => {
    const grant = grantFor(presentedToken(c));
    if (!grant) {
      return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null }, 401, {
        'WWW-Authenticate': challenge(c.req.raw),
      });
    }
    const body = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
    await endpointFor(grant).handle(c.env.incoming, c.env.outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });

  // space-scoped MCP: an agent given this URL sees exactly one space's graph
  app.all('/s/:space/mcp', async (c) => {
    const slug = c.req.param('space');
    const grant = grantFor(presentedToken(c));
    if (!grant || (grant !== '*' && grant !== slug) || !hub.info(slug)) {
      return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null }, 401, {
        'WWW-Authenticate': challenge(c.req.raw),
      });
    }
    const body = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
    await endpointFor(slug).handle(c.env.incoming, c.env.outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });

  app.all('/api/*', async (c) => {
    const grant = grantFor(presentedToken(c));
    if (!grant) return c.json({ error: 'unauthorized' }, 401);
    return apiFor(grant).fetch(c.req.raw, c.env);
  });

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

export async function runHttpServer(hub: Hub, port: number): Promise<void> {
  const bus = new EventEmitter();
  const gitSync = process.env.WAKE_GIT_SYNC === '1';
  for (const { info, ws } of hub.all()) {
    const sync = gitSync ? startGitSync(info.path) : undefined;
    startWatcher(ws, (rel) => {
      bus.emit('change', `${info.slug}/${rel}`);
      sync?.touch();
    });
  }

  const app = buildHttpApp(hub, { bus });
  const token = process.env.WAKE_TOKEN;

  serve({ fetch: app.fetch, port, hostname: process.env.WAKE_HOST || undefined }, () => {
    const spaces = hub.spaces();
    console.log(`wake reading ui + api on http://localhost:${port}`);
    console.log(
      `${spaces.length} space${spaces.length === 1 ? '' : 's'}: ${spaces.map((s) => s.slug).join(', ') || '(none yet — create one with `wake space new <name>`)'}`,
    );
    console.log(`wake mcp (streamable http) on http://localhost:${port}/mcp${token ? ' [token required]' : ''}`);
    if (!token) {
      console.log(
        'note: WAKE_TOKEN is not set — anyone who can reach this port can read and write. Fine on localhost; set it before exposing to a network.',
      );
    }
    if (gitSync) console.log(`git sync enabled${process.env.WAKE_GIT_PUSH === '1' ? ' (with push)' : ''}`);
  });
}
