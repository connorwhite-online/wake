import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Workspace } from './workspace.js';
import { indexFile, removeFile } from './indexer.js';
import { classify } from './paths.js';

/**
 * Keep the index fresh while `wake serve` runs. Writers already write-through,
 * so re-indexing their changes here is redundant but harmless (idempotent).
 */
export function startWatcher(ws: Workspace, onChange?: (relPath: string) => void): FSWatcher {
  const watcher = chokidar.watch(ws.root, {
    ignored: (p) => {
      const rel = path.relative(ws.root, p);
      return rel.startsWith('.wake') || rel.startsWith('.git') || rel.includes('node_modules');
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  const toRel = (p: string) => path.relative(ws.root, p).replace(/\\/g, '/');

  watcher.on('add', (p) => handle(toRel(p)));
  watcher.on('change', (p) => handle(toRel(p)));
  watcher.on('unlink', (p) => {
    const rel = toRel(p);
    removeFile(ws.root, ws.db, rel);
    onChange?.(rel);
  });

  function handle(rel: string) {
    if (classify(rel).kind === 'ignore') return;
    try {
      indexFile(ws.root, ws.db, rel);
      onChange?.(rel);
    } catch (err) {
      console.error(`wake watch: failed to index ${rel}: ${(err as Error).message}`);
    }
  }

  return watcher;
}
