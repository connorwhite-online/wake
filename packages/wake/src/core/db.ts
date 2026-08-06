import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const SCHEMA_VERSION = '1';

const DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE nodes (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  path       TEXT NOT NULL UNIQUE,
  slug       TEXT,
  space      TEXT NOT NULL DEFAULT 'home',
  state      TEXT,
  project_id TEXT,
  author     TEXT,
  created    TEXT NOT NULL,
  updated    TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  extra      TEXT NOT NULL DEFAULT '{}',
  body       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX nodes_type ON nodes(type);
CREATE INDEX nodes_project ON nodes(project_id, state);
CREATE INDEX nodes_updated ON nodes(updated DESC);

CREATE TABLE edges (
  src  TEXT NOT NULL,
  dst  TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (src, dst, kind)
);
CREATE INDEX edges_dst ON edges(dst);

-- raw [[wiki link]] targets, resolved against nodes at query time
CREATE TABLE wikilinks (
  src    TEXT NOT NULL,
  target TEXT NOT NULL,
  PRIMARY KEY (src, target)
);
CREATE INDEX wikilinks_target ON wikilinks(target);

CREATE TABLE activity (
  node_id  TEXT NOT NULL,
  ts       TEXT NOT NULL,
  actor    TEXT NOT NULL,
  kind     TEXT NOT NULL,
  payload  TEXT NOT NULL DEFAULT '{}',
  src_file TEXT NOT NULL,
  src_line INTEGER NOT NULL,
  UNIQUE (src_file, src_line)
);
CREATE INDEX activity_node ON activity(node_id, ts);
CREATE INDEX activity_ts ON activity(ts DESC);

CREATE TABLE files (
  path    TEXT PRIMARY KEY,
  mtime   INTEGER NOT NULL,
  size    INTEGER NOT NULL,
  node_id TEXT,
  lines   INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE nodes_fts USING fts5(
  title, body, tags, content='nodes', content_rowid='rowid'
);
CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;
CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
END;
CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
  INSERT INTO nodes_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;
`;

const TABLES = ['meta', 'nodes', 'edges', 'wikilinks', 'activity', 'files'];

/**
 * Open (creating/rebuilding as needed) the index database. The index is a
 * disposable cache: on schema-version mismatch every table is dropped and the
 * caller is told to reindex.
 */
export function openDb(dbFile: string): { db: Database.Database; needsReindex: boolean } {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const fresh = !fs.existsSync(dbFile);
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  let needsReindex = fresh;
  if (!fresh) {
    let version: string | undefined;
    try {
      const row = db
        .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
        .get() as { value: string } | undefined;
      version = row?.value;
    } catch {
      version = undefined;
    }
    if (version !== SCHEMA_VERSION) {
      for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
      db.exec(`DROP TABLE IF EXISTS nodes_fts`);
      needsReindex = true;
    } else {
      return { db, needsReindex: false };
    }
  }
  db.exec(DDL);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(SCHEMA_VERSION);
  return { db, needsReindex };
}
