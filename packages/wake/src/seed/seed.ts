import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newId, slugify } from '../core/ids.js';
import { saveNode, appendActivity } from '../core/store.js';
import * as P from '../core/paths.js';
import { Workspace } from '../core/workspace.js';
import { writeStatus } from '../core/rollup.js';
import type {
  EdgeType,
  EventKind,
  IssueState,
  ProjectFrontmatter,
  IssueFrontmatter,
  DocFrontmatter,
  ArtifactFrontmatter,
  Link,
} from '../core/schema.js';

// ---------- time helpers ----------

/** ISO timestamp N days before "now", at a given UTC hour/minute. Backdating helper for the seed. */
function daysAgo(n: number, hourUtc = 12, minuteUtc = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return d.toISOString();
}

interface EvSpec {
  d: number;
  h: number;
  m?: number;
  kind: EventKind;
  actor: string;
  payload?: Record<string, unknown>;
}

function evTs(e: EvSpec): string {
  return daysAgo(e.d, e.h, e.m ?? 0);
}

function dirNonEmpty(p: string): boolean {
  try {
    return fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

function rmIfExists(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

// ---------- content ----------

const PROJECT_TITLE = 'Wake';
const PROJECT_SLUG = slugify(PROJECT_TITLE);

const PROJECT_BODY = `# Wake

Wake is the trail something leaves as it moves — agents move, you read the wake.

A personal tool between Linear and Notion/Obsidian: a knowledge store with issue and
project tracking, operated primarily by coding agents over MCP, read by a human
through a local reading UI.

## Principles

- **Files are ground truth.** Markdown with YAML frontmatter for projects, issues,
  and docs; NDJSON for activity logs; blobs in \`artifacts/\`. SQLite is a disposable
  index, never authoritative.
- **Agents write, humans read.** Status is derived from activity, not manually
  dragged across a board. The human's job is to open the app and understand where
  things stand.
- **Derived vs authored.** Specs, decisions, and docs are authored — ground truth,
  treated as instruction. Statuses, changelogs, and activity logs are derived —
  regenerated from reality, never hand-edited.

## Scope (v1)

Core data model and file layout, a SQLite/FTS5 index with a watcher, an MCP server
exposing the write surface to agents, and a reading UI good enough to replace
opening Linear.
`;

const PROJECT_EVENTS: EvSpec[] = [
  { d: 24, h: 9, kind: 'created', actor: 'connor', payload: { type: 'project', title: PROJECT_TITLE } },
  { d: 16, h: 11, kind: 'note', actor: 'claude-code', payload: { text: 'First working reindex + FTS5 search demoed end to end.' } },
  { d: 4, h: 15, kind: 'note', actor: 'connor', payload: { text: 'SSE work paused pending watcher event stream; picking up thread node design instead.' } },
];

interface IssueSeed {
  title: string;
  body: string;
  state: IssueState;
  events: EvSpec[];
  links?: (issueIds: string[]) => Link[];
}

// Index reference used for cross-issue links (blocks): idx 2 blocks idx 6.
const ISSUE_SEEDS: IssueSeed[] = [
  {
    title: 'Design file schema and node frontmatter',
    body: 'Define the zod schemas for project/issue/doc/artifact frontmatter and the shared base fields (id, title, created, updated, author, tags, links, space).',
    state: 'done',
    events: [
      { d: 24, h: 9, kind: 'created', actor: 'connor' },
      { d: 23, h: 14, kind: 'note', actor: 'claude-code', payload: { text: 'Drafting zod schemas for the four node frontmatter shapes.' } },
      { d: 22, h: 10, kind: 'state_changed', actor: 'connor', payload: { from: 'triage', to: 'in-progress', reason: 'Starting schema design' } },
      { d: 21, h: 16, kind: 'state_changed', actor: 'claude-code', payload: { from: 'in-progress', to: 'done', reason: 'Schema landed; zod validates all four node types' } },
    ],
  },
  {
    title: 'SQLite indexer with FTS5 search',
    body: 'Build the SQLite index — nodes, edges, wikilinks, activity tables — plus an FTS5 virtual table over title/body/tags, with full reindex and incremental catch-up scans.',
    state: 'done',
    events: [
      { d: 22, h: 9, m: 30, kind: 'created', actor: 'claude-code' },
      { d: 22, h: 9, m: 31, kind: 'state_changed', actor: 'claude-code', payload: { from: 'triage', to: 'todo', reason: 'Queued behind schema' } },
      { d: 20, h: 13, kind: 'state_changed', actor: 'connor', payload: { from: 'todo', to: 'in-progress', reason: 'Starting indexer + FTS5 virtual table' } },
      { d: 17, h: 15, kind: 'note', actor: 'claude-code', payload: { text: 'FTS5 content table wired to nodes; backlinks via an edges + wikilinks join.' } },
      { d: 15, h: 12, kind: 'state_changed', actor: 'connor', payload: { from: 'in-progress', to: 'done', reason: 'Full reindex and catch-up scan both passing' } },
    ],
  },
  {
    title: 'File watcher incremental reindex',
    body: 'Watch the workspace with chokidar and call indexFile incrementally instead of relying solely on catch-up scans at process start.',
    state: 'in-progress',
    events: [
      { d: 12, h: 10, kind: 'created', actor: 'connor' },
      { d: 12, h: 10, m: 5, kind: 'state_changed', actor: 'connor', payload: { from: 'triage', to: 'todo', reason: 'Ready to pick up' } },
      { d: 10, h: 9, kind: 'state_changed', actor: 'claude-code', payload: { from: 'todo', to: 'in-progress', reason: 'Wiring the chokidar watch loop' } },
      { d: 1, h: 17, kind: 'note', actor: 'claude-code', payload: { text: 'Watcher debounces bursty saves now; still need rename-as-delete+create handling.' } },
    ],
    links: (issueIds) => [{ to: issueIds[6], type: 'blocks' as EdgeType }],
  },
  {
    title: 'regenerate_status two-call handshake',
    body: 'Server computes a rule-based rollup (counts, blocked, stale, active_hint) and hands it to the calling agent; the agent supplies prose and the server commits status.md with a rollup hash.',
    state: 'in-progress',
    events: [
      { d: 8, h: 11, kind: 'created', actor: 'claude-code' },
      { d: 8, h: 11, m: 2, kind: 'state_changed', actor: 'claude-code', payload: { from: 'triage', to: 'todo', reason: 'Ready to pick up' } },
      { d: 6, h: 14, kind: 'state_changed', actor: 'connor', payload: { from: 'todo', to: 'in-progress', reason: 'Implementing rollup hash + prose handoff' } },
      { d: 2, h: 9, kind: 'note', actor: 'claude-code', payload: { text: 'rollup_hash now stable across the day-granular cutoffs.' } },
    ],
  },
  {
    title: 'Wiki-link resolution in markdown renderer',
    body: 'Resolve [[wiki links]] in rendered markdown against node id or title, and surface unresolved targets distinctly in the reading UI.',
    state: 'todo',
    events: [
      { d: 7, h: 10, kind: 'created', actor: 'connor' },
      { d: 7, h: 10, m: 1, kind: 'state_changed', actor: 'connor', payload: { from: 'triage', to: 'todo', reason: 'Ready to pick up' } },
      { d: 1, h: 12, kind: 'note', actor: 'claude-code', payload: { text: 'Resolver checks id first, then falls back to a case-insensitive title match.' } },
    ],
  },
  {
    title: 'Thread node type and NDJSON messages',
    body: 'Design the thread node type — participants, open/resolved state, NDJSON message log — attachable to any node in the graph.',
    state: 'triage',
    events: [{ d: 3, h: 15, kind: 'created', actor: 'connor' }],
  },
  {
    title: 'Real-time SSE updates in reading UI',
    body: "Push live activity into the reading UI via server-sent events so the Home view updates without polling.",
    state: 'blocked',
    events: [
      { d: 6, h: 9, kind: 'created', actor: 'claude-code' },
      { d: 6, h: 9, m: 1, kind: 'state_changed', actor: 'claude-code', payload: { from: 'triage', to: 'todo', reason: 'Ready to pick up' } },
      { d: 5, h: 10, kind: 'state_changed', actor: 'connor', payload: { from: 'todo', to: 'blocked', reason: 'Needs incremental reindex events from the watcher first' } },
    ],
  },
  {
    title: 'Estimates and sprint planning',
    body: "Story points, velocity, sprint burndown — the Linear machinery this tool is explicitly not trying to rebuild.",
    state: 'dropped',
    events: [
      { d: 10, h: 9, kind: 'created', actor: 'connor' },
      { d: 10, h: 9, m: 1, kind: 'state_changed', actor: 'connor', payload: { from: 'triage', to: 'todo', reason: 'Ready to pick up' } },
      { d: 9, h: 14, kind: 'state_changed', actor: 'claude-code', payload: { from: 'todo', to: 'dropped', reason: 'Linear overbuild — explicitly a non-goal' } },
    ],
  },
  {
    title: 'Typography pass on doc rendering',
    body: "Tighten measure, line-height, and heading rhythm on rendered docs — this is the view a human actually lives in.",
    state: 'todo',
    events: [
      { d: 5, h: 11, kind: 'created', actor: 'claude-code' },
      { d: 5, h: 11, m: 1, kind: 'state_changed', actor: 'claude-code', payload: { from: 'triage', to: 'todo', reason: 'Ready to pick up' } },
    ],
  },
  {
    title: 'Artifact blob storage with sha256 naming',
    body: 'Store artifact blobs content-addressed by sha256 (first 16 hex chars) with a markdown sidecar carrying frontmatter and caption.',
    state: 'done',
    events: [
      { d: 9, h: 10, kind: 'created', actor: 'connor' },
      { d: 9, h: 10, m: 1, kind: 'state_changed', actor: 'connor', payload: { from: 'triage', to: 'todo', reason: 'Ready to pick up' } },
      { d: 8, h: 9, kind: 'state_changed', actor: 'claude-code', payload: { from: 'todo', to: 'in-progress', reason: 'Implementing sha256 blob naming + sidecar frontmatter' } },
      { d: 6, h: 16, kind: 'state_changed', actor: 'connor', payload: { from: 'in-progress', to: 'done', reason: 'Artifacts store as content-addressed blobs with markdown sidecars' } },
    ],
  },
  {
    title: 'Loop runner scheduler design',
    body: 'Sketch the loop runner: cron/event triggers, shelling out to an agent CLI, transcript capture, and required MCP-mediated result filing.',
    state: 'triage',
    events: [{ d: 2, h: 13, kind: 'created', actor: 'claude-code' }],
  },
  {
    title: 'Home view since-last-visit diffing',
    body: "Compute what's new since the human's last visit — recent activity, freshly derived statuses, open questions — for the Home view.",
    state: 'in-progress',
    events: [
      { d: 20, h: 9, kind: 'created', actor: 'connor' },
      { d: 20, h: 9, m: 1, kind: 'state_changed', actor: 'connor', payload: { from: 'triage', to: 'todo', reason: 'Ready to pick up' } },
      { d: 20, h: 9, m: 30, kind: 'state_changed', actor: 'connor', payload: { from: 'todo', to: 'in-progress', reason: 'Sketching the diff algorithm against last-visit timestamp' } },
    ],
  },
];

interface DocSeed {
  relPath: string;
  title: string;
  tags: string[];
  d: number;
  h: number;
  author: string;
  body: string;
}

const DOC_SEEDS: DocSeed[] = [
  {
    relPath: 'architecture/data-model.md',
    title: 'Data Model',
    tags: ['architecture', 'data-model'],
    d: 23,
    h: 11,
    author: 'claude-code',
    body: `Every object in the graph — project, issue, doc, artifact, and eventually thread
and loop — is a **node**: a markdown file with YAML frontmatter carrying \`id\`
(a ULID), \`type\`, \`title\`, \`created\`, \`updated\`, \`author\`, \`tags[]\`, \`links[]\`,
and \`space\`. ULIDs sort lexicographically by creation time and don't require a
central counter, so agents can mint ids offline and never collide.

Nodes are also split into what's **authored** and what's **derived**. Authored
content — a project charter, an issue description, a doc body, a decision record —
is ground truth, written by a human or an agent and treated as instruction. Derived
content — an issue's \`state\`, \`status.md\`, the \`updated\` timestamp, the NDJSON
activity logs — is exhaust: regenerated from activity, never hand-edited. The MCP
write tools hard-reject patches that touch a derived field; raw file edits remain
physically possible (files are truth, after all) but [[ADR 001: Files as Truth]]
marks them hands-off by convention.

A related distinction is **node vs placement**: a node is the content object
itself, while a placement is its context inside a space — local threads, status
overlays, annotations. Content can be shared across spaces; conversation stays
local to one. It's the same split as git objects vs refs. In v1 there is exactly
one implicit space, \`home\`, but every node carries a \`space\` field now so
multiplayer doesn't require a schema migration later — it requires a placement
table.

Edges come in two flavors. Typed edges live in frontmatter's \`links[]\` — a fixed
vocabulary (\`relates-to\`, \`blocks\`, \`documents\`, \`discusses\`, \`produced-by\`)
that an agent or human writes deliberately. Wiki-links are index-only: the
[[Indexing Pipeline]] extracts \`[[Target]]\` references out of node bodies at
index time and reconstructs backlinks from them, but a wiki-link is never written
back into frontmatter — it's a cheap, prose-native way to say "this refers to
that" without formal edge bookkeeping.`,
  },
  {
    relPath: 'architecture/indexing.md',
    title: 'Indexing Pipeline',
    tags: ['architecture', 'indexing', 'sqlite'],
    d: 19,
    h: 14,
    author: 'claude-code',
    body: `SQLite is a disposable cache over the files, not the source of truth. Deleting
\`.wake/index.db\` and reindexing must always reproduce the same graph — if it
doesn't, that's a bug in the indexer, not a reason to trust the database over
the files. See [[Data Model]] for what a node actually is; this doc is about how
it gets from a markdown file on disk into rows an app can query.

Two entrypoints keep the index correct without a long-running watcher being a
hard requirement. \`fullReindex\` wipes every index table and walks the whole
workspace tree, indexing each file from scratch. \`catchUp\` is the cheaper path:
it compares each file's \`mtime\`/\`size\` against what's recorded in the \`files\`
table, reindexes what changed, and removes rows for files that disappeared. Every
\`Workspace.open\` call runs one or the other, so any entrypoint — CLI, MCP
server, tests — is correct even if no watcher was running when a file changed on
disk. [[File watcher incremental reindex]] adds a third path, a chokidar watch
loop that calls \`indexFile\` incrementally as changes happen, so the reading UI
doesn't wait for the next process start to see new activity.

\`indexFile\` is written to be idempotent and per-file: given a workspace-relative
path, it classifies the path (project, issue, doc, artifact sidecar, activity
log, or status.md) and upserts exactly the rows that file produces. Node files go
through \`upsertNode\`, which writes the \`nodes\` row, deletes and re-inserts that
node's \`edges\` rows from \`links[]\`, and deletes and re-inserts its \`wikilinks\`
rows from a regex scan of the body for \`[[...]]\` targets — see
[[Wiki-link resolution in markdown renderer]] for the read-side half of that
feature, resolving a target back to a node.

Activity NDJSON files are append-only, so the indexer tails them: it tracks how
many lines of each \`.ndjson\` file it has already ingested and only parses new
lines on the next pass, using a \`UNIQUE(src_file, src_line)\` constraint on the
\`activity\` table to make re-indexing a line a no-op rather than a duplicate.
Search itself is FTS5 — a virtual table over \`title\`, \`body\`, and \`tags\`, kept
in sync with the \`nodes\` table by triggers, so full-text search never needs its
own reindex pass.`,
  },
  {
    relPath: 'decisions/001-files-as-truth.md',
    title: 'ADR 001: Files as Truth',
    tags: ['decision', 'architecture'],
    d: 23,
    h: 9,
    author: 'connor',
    body: `**Status:** accepted.

**Context.** Wake needs a storage layer that agents can write to fluently, that
survives the SQLite index being deleted, and that gives us history and diffing
for free. See [[Data Model]] for the node shape this decision produces.

**Decision.** Plain files in a git repo are ground truth. Markdown with YAML
frontmatter for projects, issues, and docs; NDJSON for append-only activity logs;
content-addressed blobs under \`artifacts/\`. SQLite (\`.wake/index.db\`) is a
disposable index rebuilt from those files by the pipeline described in
[[Indexing Pipeline]] — it powers search, backlinks, and dashboards, and is never
the thing an agent or human should treat as authoritative.

**Consequences.** Git gives us history, diffing, and sync without building any
of it ourselves; agents can read and write the repo directly when MCP isn't
available, because the format is just markdown and JSON lines, not a proprietary
API. The cost is that the MCP write tools have to hard-reject patches to derived
fields (state, \`updated\`, \`status.md\`, the activity logs themselves) to keep the
authored/derived split meaningful, while raw file edits stay physically legal —
CONVENTIONS.md is what tells an agent operating without MCP to leave those files
alone rather than a hard technical barrier.

**Alternatives considered.** A database-backed system (Linear-style) was
rejected outright — the primitive of a human-authored ticket doesn't fit
agent-driven work, and betting the source of truth on a proprietary store is
exactly the lock-in this project exists to avoid.`,
  },
  {
    relPath: 'mcp-tools.md',
    title: 'MCP Tool Reference',
    tags: ['mcp', 'reference'],
    d: 14,
    h: 10,
    author: 'claude-code',
    body: `The MCP server is the primary write interface for agents; see [[Data Model]]
for the shapes these tools read and write. Reads: \`search(query, type?, tags?)\`,
\`get_node(id)\`, \`list(type, filters)\`. Writes: \`create_node(type, fields)\`,
\`update_node(id, patch)\` — patches touching a protected field (\`state\`,
\`links\`, \`updated\`, and friends) are rejected with an actionable message rather
than silently accepted. \`set_issue_state(id, state, reason)\` is the only
sanctioned way to move an issue's state; it appends a \`state_changed\` event to
that issue's NDJSON activity log rather than editing frontmatter directly.
\`log_activity(node_id, event)\` records a free-text note — commits, run results,
decisions worth remembering. \`append_doc(id, section, content)\` and
\`write_doc(path, content)\` cover authored knowledge. \`link(a, b, edge_type)\`
adds a typed edge in both directions' activity logs.

\`regenerate_status(project_id)\` is a two-call handshake rather than a single
tool call, and it's worth understanding why: the server can compute a rule-based
rollup — issue counts by state, what's blocked and by what, what's gone stale,
which \`todo\` issues have an "active hint" from recent notes — but it has no
opinion and no API key with which to turn that into readable prose. So the first
call returns the rollup plus a hash of it; the calling agent, which is already an
LLM, writes 2-4 sentences of summary; the second call passes that prose back
along with the hash, and the server commits \`status.md\` if the hash still
matches what's on disk. See [[regenerate_status two-call handshake]] for where
that lives in the codebase right now, and [[Indexing Pipeline]] for how the
rollup's counts get computed.

Resources expose docs and project statuses read-only, so an agent can pull
context cheaply without a full \`search\` round-trip when it already knows what
it wants.`,
  },
];

// ---------- writers ----------

function writeIssueEvents(root: string, activityRel: string, nodeId: string, events: EvSpec[]): void {
  for (const e of events) {
    appendActivity(root, activityRel, {
      ts: evTs(e),
      actor: e.actor,
      node: nodeId,
      kind: e.kind,
      payload: e.payload ?? {},
    });
  }
}

export function runSeed(root: string, opts: { force?: boolean } = {}): {
  projects: number;
  issues: number;
  docs: number;
  artifacts: number;
} {
  const projectsDir = path.join(root, 'projects');
  const docsDir = path.join(root, 'docs');
  if (!opts.force && (dirNonEmpty(projectsDir) || dirNonEmpty(docsDir))) {
    throw new Error(
      `workspace at ${root} already has projects and/or docs — pass --force to seed anyway (this will overwrite the dogfood content)`,
    );
  }

  fs.mkdirSync(root, { recursive: true });
  if (opts.force) {
    for (const d of ['projects', 'docs', 'artifacts', 'activity', '.wake']) {
      rmIfExists(path.join(root, d));
    }
  }

  // ---------- project ----------

  const projectId = newId();
  const projectFirstEvent = evTs(PROJECT_EVENTS[0]);
  const projectLastEvent = evTs(PROJECT_EVENTS[PROJECT_EVENTS.length - 1]);
  const projectFm: ProjectFrontmatter = {
    id: projectId,
    title: PROJECT_TITLE,
    created: projectFirstEvent,
    updated: projectLastEvent,
    author: 'connor',
    tags: ['meta'],
    links: [],
    space: 'home',
    archived: false,
    type: 'project',
  };
  saveNode(root, P.projectPath(PROJECT_SLUG), projectFm, PROJECT_BODY);
  writeIssueEvents(root, P.projectActivityPath(PROJECT_SLUG), projectId, PROJECT_EVENTS);

  // ---------- issues ----------

  const issueIds = ISSUE_SEEDS.map(() => newId());

  ISSUE_SEEDS.forEach((seed, idx) => {
    const id = issueIds[idx];
    const firstEvent = evTs(seed.events[0]);
    const lastEvent = evTs(seed.events[seed.events.length - 1]);
    const links = seed.links ? seed.links(issueIds) : [];
    const fm: IssueFrontmatter = {
      id,
      title: seed.title,
      created: firstEvent,
      updated: lastEvent,
      author: seed.events[0].actor,
      tags: [],
      links,
      space: 'home',
      archived: false,
      type: 'issue',
      state: seed.state,
      project: projectId,
    };
    const eventsWithTitle = seed.events.map((e, i) =>
      i === 0 ? { ...e, payload: { type: 'issue', title: seed.title, ...(e.payload ?? {}) } } : e,
    );
    saveNode(root, P.issuePath(PROJECT_SLUG, id), fm, seed.body);
    writeIssueEvents(root, P.issueActivityPath(PROJECT_SLUG, id), id, eventsWithTitle);
  });

  // ---------- docs ----------

  for (const doc of DOC_SEEDS) {
    const id = newId();
    const ts = daysAgo(doc.d, doc.h);
    const fm: DocFrontmatter = {
      id,
      title: doc.title,
      created: ts,
      updated: ts,
      author: doc.author,
      tags: doc.tags,
      links: [{ to: projectId, type: 'documents' }],
      space: 'home',
      archived: false,
      type: 'doc',
    };
    saveNode(root, P.docPath(doc.relPath), fm, doc.body);
    appendActivity(root, P.WORKSPACE_ACTIVITY_PATH, {
      ts,
      actor: doc.author,
      node: id,
      kind: 'created',
      payload: { type: 'doc', title: doc.title },
    });
  }

  // ---------- artifact ----------

  const artifactIssueId = issueIds[9]; // "Artifact blob storage with sha256 naming"
  const csvContent = [
    'files,mode,duration_ms',
    '120,full,340',
    '120,catchup,18',
    '850,full,1890',
    '850,catchup,64',
    '4200,full,7210',
    '4200,catchup,210',
    '',
  ].join('\n');
  const hash = crypto.createHash('sha256').update(csvContent).digest('hex').slice(0, 16);
  const blobRel = P.artifactBlobPath(`${hash}.csv`);
  fs.mkdirSync(path.dirname(path.join(root, blobRel)), { recursive: true });
  fs.writeFileSync(path.join(root, blobRel), csvContent, 'utf8');

  const artifactId = newId();
  const artifactTs = daysAgo(6, 17);
  const artifactTitle = 'Reindex Benchmark Results';
  const artifactFm: ArtifactFrontmatter = {
    id: artifactId,
    title: artifactTitle,
    created: artifactTs,
    updated: artifactTs,
    author: 'claude-code',
    tags: ['benchmark', 'indexing'],
    links: [{ to: artifactIssueId, type: 'produced-by' }],
    space: 'home',
    archived: false,
    type: 'artifact',
    file: `${hash}.csv`,
    mime: 'text/csv',
  };
  saveNode(
    root,
    P.artifactSidecarPath(hash),
    artifactFm,
    `Timing samples from the full-reindex vs. catch-up scan comparison, across workspaces of increasing file count. Backing [[Artifact blob storage with sha256 naming]] and the numbers cited when [[SQLite indexer with FTS5 search]] moved to done.`,
  );
  appendActivity(root, P.WORKSPACE_ACTIVITY_PATH, {
    ts: artifactTs,
    actor: 'claude-code',
    node: artifactId,
    kind: 'created',
    payload: { type: 'artifact', title: artifactTitle },
  });

  // ---------- index + status ----------

  const ws = Workspace.open(root);
  // short on purpose: the reading UI renders the counts, so prose says what
  // moved and what is stuck, not what the numbers already show
  const summaryProse =
    `The watcher and the regenerate_status handshake are the live edges of the work. ` +
    `SSE updates can't start until the watcher lands, and the since-last-visit diffing has been quiet ` +
    `for two weeks — it needs a nudge or a drop.`;
  writeStatus(ws, projectId, summaryProse, 'claude-code');
  ws.close();

  return {
    projects: 1,
    issues: ISSUE_SEEDS.length,
    docs: DOC_SEEDS.length,
    artifacts: 1,
  };
}
