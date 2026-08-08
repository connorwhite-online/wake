import fs from 'node:fs';
import path from 'node:path';

/** Directories that are derived, machine-local, or otherwise not the record. */
const SKIP_DIRS = new Set(['.wake', '.git', 'node_modules']);

export interface TransferFile {
  /** POSIX-style path relative to the space root */
  path: string;
  content: string;
}

export interface ApplyResult {
  written: string[];
  skipped: string[];
  rejected: string[];
}

/** Every file that makes up a space's record, as ground truth on disk. */
export function collectSpaceFiles(root: string): TransferFile[] {
  const out: TransferFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      out.push({
        path: path.relative(root, full).split(path.sep).join('/'),
        content: fs.readFileSync(full, 'utf8'),
      });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * A path is safe only if it stays inside the space once resolved. This is the
 * one place untrusted paths from over the wire become filesystem writes, so it
 * rejects rather than sanitises — a path that needed fixing is a path we do not
 * understand.
 */
export function safeRelative(root: string, rel: string): string | null {
  if (!rel || path.isAbsolute(rel) || rel.includes('\0')) return null;
  const segments = rel.split('/');
  if (segments.some((s) => s === '..' || SKIP_DIRS.has(s))) return null;
  const full = path.resolve(root, rel);
  const within = path.resolve(root) + path.sep;
  return full.startsWith(within) ? full : null;
}

/**
 * When this file was last written, per its own frontmatter. Authored nodes
 * stamp `updated`; derived ones like status.md stamp `generated` instead, and
 * missing the second spelling is why a stale status survives a sync.
 */
function updatedAt(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  const line = /^(?:updated|generated):\s*['"]?([^'"\n]+)['"]?\s*$/m.exec(match[1]);
  return line ? line[1].trim() : null;
}

/**
 * Is the incoming copy a later version of the same node? Only true when both
 * sides carry a stamp and the incoming one is strictly later — an unstamped
 * file is not evidence of anything, so it loses.
 */
export function isNewer(incoming: string, existing: string): boolean {
  const a = updatedAt(incoming);
  const b = updatedAt(existing);
  return a !== null && b !== null && a > b;
}

/**
 * Union two append-only logs, ordered by timestamp. Returns null when the
 * incoming side adds nothing, so the caller can report it as untouched.
 *
 * Dedupe is by exact line: every event carries a ts and an actor, and wake
 * never rewrites a line once written, so identical text is the same event.
 */
export function mergeNdjson(existing: string, incoming: string): string | null {
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const have = new Set(lines(existing));
  const added = lines(incoming).filter((l) => !have.has(l));
  if (!added.length) return null;

  const tsOf = (line: string): string => {
    try {
      return (JSON.parse(line) as { ts?: string }).ts ?? '';
    } catch {
      return '';
    }
  };
  // stable by ts, and ties keep the order they already had
  const all = [...lines(existing), ...added].map((line, i) => ({ line, ts: tsOf(line), i }));
  all.sort((a, b) => (a.ts === b.ts ? a.i - b.i : a.ts < b.ts ? -1 : 1));
  return all.map((e) => e.line).join('\n') + '\n';
}

/**
 * Write an incoming set of files into a space.
 *
 * Additive by default: a path that already exists is left alone, because the
 * receiving instance is the live one and its copy is the one someone has been
 * reading. `overwrite` is for deliberate restores.
 */
export function applyFiles(root: string, files: TransferFile[], overwrite = false): ApplyResult {
  const result: ApplyResult = { written: [], skipped: [], rejected: [] };
  for (const file of files) {
    const full = safeRelative(root, file.path);
    if (!full) {
      result.rejected.push(file.path);
      continue;
    }
    // Activity logs are append-only, so two copies of one log are never in
    // conflict — they are two subsets of the same history. Merging is the
    // correct join, and skipping them would drop precisely the events that
    // make the timeline worth reading.
    if (file.path.endsWith('.ndjson') && fs.existsSync(full)) {
      const merged = mergeNdjson(fs.readFileSync(full, 'utf8'), file.content);
      if (merged === null) {
        result.skipped.push(file.path);
        continue;
      }
      fs.writeFileSync(full, merged);
      result.written.push(file.path);
      continue;
    }
    if (!overwrite && fs.existsSync(full)) {
      // Markdown nodes carry their own `updated`, so the two copies are not
      // really in conflict — one of them is simply later. Taking the newer one
      // is what makes a stale status.md refresh without a blanket --overwrite
      // that would also flatten anything edited on the receiving side.
      if (!isNewer(file.content, fs.readFileSync(full, 'utf8'))) {
        result.skipped.push(file.path);
        continue;
      }
    }
    if (overwrite && fs.existsSync(full) && fs.readFileSync(full, 'utf8') === file.content) {
      result.skipped.push(file.path);
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file.content);
    result.written.push(file.path);
  }
  return result;
}
