import { z } from 'zod';

export const NODE_TYPES = ['project', 'issue', 'doc', 'artifact'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const ISSUE_STATES = ['triage', 'todo', 'in-progress', 'blocked', 'done', 'dropped'] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

// Edge types agents may author in frontmatter. 'references' is index-only,
// produced by wiki-link extraction — never written to frontmatter.
export const EDGE_TYPES = ['relates-to', 'blocks', 'documents', 'discusses', 'produced-by'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const EVENT_KINDS = [
  'created',
  'state_changed',
  'note',
  'linked',
  'doc_appended',
  'status_regenerated',
  'field_updated',
  'archived',
  'unarchived',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const linkSchema = z.object({
  to: z.string(),
  type: z.enum(EDGE_TYPES),
});
export type Link = z.infer<typeof linkSchema>;

// YAML parsers hand back Date objects for unquoted timestamps; normalize to ISO strings.
const isoDate = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString() : v),
  z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO date'),
);

const baseFrontmatter = z.object({
  id: z.string(),
  title: z.string(),
  created: isoDate,
  updated: isoDate,
  author: z.string().default('unknown'),
  tags: z.array(z.string()).default([]),
  links: z.array(linkSchema).default([]),
  // Space indirection for future multiplayer; omitted means 'home'.
  space: z.string().default('home'),
  // Soft, reversible removal — archived nodes vanish from lists, search, and
  // rollups but stay on disk ("remove" and "delete" are different verbs).
  archived: z.boolean().default(false),
});

export const projectFrontmatter = baseFrontmatter.extend({
  type: z.literal('project'),
});

export const issueFrontmatter = baseFrontmatter.extend({
  type: z.literal('issue'),
  state: z.enum(ISSUE_STATES),
  project: z.string(),
});

export const docFrontmatter = baseFrontmatter.extend({
  type: z.literal('doc'),
});

export const artifactFrontmatter = baseFrontmatter.extend({
  type: z.literal('artifact'),
  file: z.string(),
  mime: z.string().default('application/octet-stream'),
});

export const nodeFrontmatter = z.discriminatedUnion('type', [
  projectFrontmatter,
  issueFrontmatter,
  docFrontmatter,
  artifactFrontmatter,
]);

export type ProjectFrontmatter = z.infer<typeof projectFrontmatter>;
export type IssueFrontmatter = z.infer<typeof issueFrontmatter>;
export type DocFrontmatter = z.infer<typeof docFrontmatter>;
export type ArtifactFrontmatter = z.infer<typeof artifactFrontmatter>;
export type NodeFrontmatter = z.infer<typeof nodeFrontmatter>;

export interface Node {
  fm: NodeFrontmatter;
  body: string;
  /** workspace-relative path of the .md file */
  path: string;
}

export const activityEventSchema = z.object({
  ts: isoDate,
  actor: z.string(),
  node: z.string(),
  kind: z.enum(EVENT_KINDS),
  payload: z.record(z.unknown()).default({}),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;

// Fields agents/humans may not touch through update_node. Each maps to the
// reason a patch gets rejected.
export const PROTECTED_FIELDS: Record<string, string> = {
  id: 'read-only field',
  type: 'read-only field',
  created: 'read-only field',
  updated: 'server-managed field — set automatically on every write',
  space: 'read-only field in v1',
  state: "'state' is derived — use set_issue_state",
  project: "'project' is structural — file a new issue instead",
  links: "'links' are managed — use the link tool",
  file: 'artifact blobs are immutable',
  archived: "'archived' is managed — use archive_node",
};
