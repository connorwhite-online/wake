import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  type ActivityEvent,
  type Node,
  type NodeFrontmatter,
  activityEventSchema,
  nodeFrontmatter,
  PROTECTED_FIELDS,
} from './schema.js';

export function nowIso(): string {
  return new Date().toISOString();
}

function abs(ws: string, relPath: string): string {
  const p = path.resolve(ws, relPath);
  if (!p.startsWith(path.resolve(ws) + path.sep)) {
    throw new Error(`path escapes workspace: ${relPath}`);
  }
  return p;
}

export function parseNodeFile(raw: string, relPath: string): Node {
  const { data, content } = matter(raw);
  const fm = nodeFrontmatter.parse(data);
  return { fm, body: content.replace(/^\n+/, ''), path: relPath };
}

export function serializeNode(fm: NodeFrontmatter, body: string): string {
  const cleanBody = body.trim() ? body.replace(/\s+$/, '') + '\n' : '';
  return matter.stringify('\n' + cleanBody, fm).replace(/^---\n/, '---\n');
}

export function loadNode(ws: string, relPath: string): Node {
  const raw = fs.readFileSync(abs(ws, relPath), 'utf8');
  return parseNodeFile(raw, relPath);
}

export function saveNode(ws: string, relPath: string, fm: NodeFrontmatter, body: string): void {
  const p = abs(ws, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, serializeNode(fm, body), 'utf8');
}

export function nodeFileExists(ws: string, relPath: string): boolean {
  return fs.existsSync(abs(ws, relPath));
}

/** Reject patches that touch protected fields. Throws with an actionable message. */
export function assertPatchAllowed(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if (key in PROTECTED_FIELDS) {
      throw new Error(`cannot patch '${key}': ${PROTECTED_FIELDS[key]}`);
    }
  }
}

export function appendActivity(ws: string, relPath: string, event: ActivityEvent): void {
  const p = abs(ws, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(event) + '\n', 'utf8');
}

export interface ActivityLine {
  event: ActivityEvent;
  line: number;
}

/** Read events from an NDJSON file starting at a 0-based line offset. Bad lines are skipped. */
export function readActivity(ws: string, relPath: string, fromLine = 0): { events: ActivityLine[]; totalLines: number } {
  const p = abs(ws, relPath);
  if (!fs.existsSync(p)) return { events: [], totalLines: 0 };
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const events: ActivityLine[] = [];
  for (let i = fromLine; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      events.push({ event: activityEventSchema.parse(JSON.parse(lines[i])), line: i });
    } catch {
      // malformed line — skip, never crash the indexer
    }
  }
  return { events, totalLines: lines.length };
}
