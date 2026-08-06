import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DB_FILE } from './paths.js';

/** Resolve the workspace (data repo) root: --space flag > WAKE_SPACE env > ~/wake-space. */
export function resolveWorkspace(explicit?: string): string {
  const p = explicit || process.env.WAKE_SPACE || path.join(os.homedir(), 'wake-space');
  return path.resolve(p);
}

export function requireWorkspace(explicit?: string): string {
  const ws = resolveWorkspace(explicit);
  if (!fs.existsSync(path.join(ws, 'projects')) && !fs.existsSync(path.join(ws, 'docs'))) {
    throw new Error(`no wake workspace at ${ws} — run \`wake init --space ${ws}\` first`);
  }
  return ws;
}

export function dbPath(workspace: string): string {
  return path.join(workspace, DB_FILE);
}
