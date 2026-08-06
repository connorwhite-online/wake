import type Database from 'better-sqlite3';

export interface NodeSummary {
  id: string;
  type: string;
  title: string;
  path: string;
  slug: string | null;
  state: string | null;
  project_id: string | null;
  author: string | null;
  created: string;
  updated: string;
  tags: string[];
}

export interface SearchResult extends NodeSummary {
  snippet: string;
  score: number;
}

export function rowToSummary(row: Record<string, unknown>): NodeSummary {
  return {
    id: row.id as string,
    type: row.type as string,
    title: row.title as string,
    path: row.path as string,
    slug: (row.slug as string) ?? null,
    state: (row.state as string) ?? null,
    project_id: (row.project_id as string) ?? null,
    author: (row.author as string) ?? null,
    created: row.created as string,
    updated: row.updated as string,
    tags: JSON.parse((row.tags as string) || '[]'),
  };
}

/** Quote each term so user input can never be FTS5 syntax. */
export function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
}

export function searchNodes(
  db: Database.Database,
  opts: { query: string; type?: string; tags?: string[]; limit?: number },
): SearchResult[] {
  const match = ftsQuery(opts.query);
  if (!match) return [];
  const limit = Math.min(opts.limit ?? 20, 100);
  const rows = db
    .prepare(
      `SELECT n.*, bm25(nodes_fts) AS score,
              snippet(nodes_fts, 1, '「', '」', '…', 14) AS snip
       FROM nodes_fts
       JOIN nodes n ON n.rowid = nodes_fts.rowid
       WHERE nodes_fts MATCH ?
         AND (@type IS NULL OR n.type = @type)
       ORDER BY score
       LIMIT @limit`,
    )
    .all(match, { type: opts.type ?? null, limit: limit * 3 }) as Record<string, unknown>[];

  let results = rows.map((r) => ({
    ...rowToSummary(r),
    snippet: (r.snip as string) ?? '',
    score: r.score as number,
  }));
  if (opts.tags?.length) {
    const want = new Set(opts.tags);
    results = results.filter((r) => r.tags.some((t) => want.has(t)));
  }
  return results.slice(0, limit);
}
