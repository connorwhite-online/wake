import path from 'node:path';

/**
 * All paths are workspace-relative POSIX strings. The space indirection is
 * the single hook future multiplayer needs: today every space maps to the
 * workspace root.
 */
export function spaceRoot(_space: string): string {
  return '.';
}

export const projectPath = (slug: string) => `projects/${slug}/project.md`;
export const statusPath = (slug: string) => `projects/${slug}/status.md`;
export const projectActivityPath = (slug: string) => `projects/${slug}/activity.ndjson`;
export const issuePath = (slug: string, id: string) => `projects/${slug}/issues/${id}.md`;
export const issueActivityPath = (slug: string, id: string) => `projects/${slug}/issues/${id}.ndjson`;
export const docPath = (docRelPath: string) => `docs/${normalizeDocPath(docRelPath)}`;
export const artifactSidecarPath = (hash: string) => `artifacts/${hash}.md`;
export const artifactBlobPath = (file: string) => `artifacts/${file}`;
export const WORKSPACE_ACTIVITY_PATH = 'activity/log.ndjson';
export const CONVENTIONS_PATH = 'CONVENTIONS.md';
export const WAKE_DIR = '.wake';
export const DB_FILE = `${WAKE_DIR}/index.db`;

/** Normalize a user-supplied doc path: strip leading docs/, ensure .md, forbid escapes. */
export function normalizeDocPath(p: string): string {
  let clean = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.startsWith('docs/')) clean = clean.slice(5);
  if (!clean.endsWith('.md')) clean += '.md';
  const normalized = path.posix.normalize(clean);
  if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
    throw new Error(`doc path escapes docs/: ${p}`);
  }
  return normalized;
}

export type Classified =
  | { kind: 'project'; slug: string }
  | { kind: 'issue'; slug: string; id: string }
  | { kind: 'doc' }
  | { kind: 'artifact-sidecar'; hash: string }
  | { kind: 'status'; slug: string }
  | { kind: 'activity' }
  | { kind: 'ignore' };

/** Classify a workspace-relative path into what the indexer should do with it. */
export function classify(relPath: string): Classified {
  const p = relPath.replace(/\\/g, '/');
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^projects\/([^/]+)\/project\.md$/))) return { kind: 'project', slug: m[1] };
  if ((m = p.match(/^projects\/([^/]+)\/status\.md$/))) return { kind: 'status', slug: m[1] };
  if ((m = p.match(/^projects\/([^/]+)\/issues\/([^/]+)\.md$/))) return { kind: 'issue', slug: m[1], id: m[2] };
  if (/^projects\/[^/]+\/issues\/[^/]+\.ndjson$/.test(p)) return { kind: 'activity' };
  if (/^projects\/[^/]+\/activity\.ndjson$/.test(p)) return { kind: 'activity' };
  if (/^docs\/.+\.md$/.test(p)) return { kind: 'doc' };
  if ((m = p.match(/^artifacts\/([^/]+)\.md$/))) return { kind: 'artifact-sidecar', hash: m[1] };
  if (p === WORKSPACE_ACTIVITY_PATH) return { kind: 'activity' };
  return { kind: 'ignore' };
}
