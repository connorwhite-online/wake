import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Workspace } from '../core/workspace.js';
import { startWatcher } from '../core/watcher.js';
import { buildApi } from './api.js';

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

export async function runHttpServer(wsRoot: string, port: number): Promise<void> {
  const ws = Workspace.open(wsRoot);
  const bus = new EventEmitter();
  startWatcher(ws, (rel) => bus.emit('change', rel));

  const app = new Hono();
  app.route('/', buildApi(ws, bus));

  const uiDist = findUiDist();
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

  serve({ fetch: app.fetch, port }, () => {
    console.log(`wake reading ui + api on http://localhost:${port} (workspace: ${wsRoot})`);
  });
}
