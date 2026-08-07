export interface NodeSummary {
  id: string;
  type: 'project' | 'issue' | 'doc' | 'artifact';
  title: string;
  path: string;
  slug: string | null;
  state: string | null;
  project_id: string | null;
  author: string | null;
  archived: boolean;
  created: string;
  updated: string;
  tags: string[];
  url: string;
  space: string;
}

export interface ActivityRow {
  node_id: string;
  ts: string;
  actor: string;
  kind: string;
  payload: Record<string, unknown>;
  node_title?: string;
  node_type?: string;
  node_url?: string | null;
}

export interface StatusSummary {
  project_id: string;
  title: string;
  slug: string;
  generated: string | null;
  generated_by: string | null;
  summary_html: string;
  rollup: Rollup;
}

export type ProjectSummary = NodeSummary & { counts: Record<string, number>; last_active: string | null };

export interface SpaceSummary {
  slug: string;
  name: string;
  description: string;
  repos?: string[];
  url: string;
  projects: number;
  issues: number;
  last_active: string | null;
}

export interface UserProfile {
  name: string;
  handle: string;
}

export interface MePayload {
  user: UserProfile;
  spaces: SpaceSummary[];
}

export interface HomePayload {
  projects: ProjectSummary[];
  statuses: StatusSummary[];
  activity: ActivityRow[];
}

export interface IssueRef {
  id: string;
  title: string;
  state: string;
  updated: string;
  last_activity: string | null;
}

/** Computed live from the index on every request — charts are never stale. */
export interface Rollup {
  project_id: string;
  project_title: string;
  counts: Record<string, number>;
  total: number;
  activity_by_day: { day: string; count: number }[];
  now: IssueRef[];
  blocked: (IssueRef & { blocked_by: { id: string; title: string }[] })[];
  recently_done: IssueRef[];
  stale: IssueRef[];
  active_hint: IssueRef[];
  latest_activity: { ts: string; actor: string; kind: string; node_title: string; summary: string }[];
}

export interface ProjectPayload {
  project: NodeSummary & { body_html: string };
  status: {
    generated: string | null;
    generated_by: string | null;
    html: string;
    summary_html: string;
  } | null;
  rollup: Rollup;
  issues: Record<string, NodeSummary[]>;
  timeline: ActivityRow[];
  docs: NodeSummary[];
}

export interface NodePayload {
  node: NodeSummary;
  body_html: string;
  project: { id: string; title: string; slug: string | null } | null;
  artifact: { file: string; mime: string; url: string } | null;
  links: (NodeSummary & { kind: string })[];
  backlinks: (NodeSummary & { kind: string })[];
  activity: ActivityRow[];
}

export type SearchResult = NodeSummary & {
  snippet: string;
  snippet_html: string;
  score: number;
  space_name?: string;
};

const TOKEN_KEY = 'wake:token';
const LAST_SPACE_KEY = 'wake:last-space';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function rememberSpace(slug: string): void {
  localStorage.setItem(LAST_SPACE_KEY, slug);
}

export function lastSpace(): string | null {
  return localStorage.getItem(LAST_SPACE_KEY);
}

/** Artifact links are browser-native navigations that can't carry a header. */
export function withToken(url: string): string {
  const t = getToken();
  return t ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}` : url;
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('wake:unauthorized'));
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (res.status === 401) {
    window.dispatchEvent(new Event('wake:unauthorized'));
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const inSpace = (space: string, path: string) => `/api/s/${encodeURIComponent(space)}${path}`;

export const api = {
  me: () => get<MePayload>('/api/me'),
  meta: (space: string) => get<{ states: Record<string, { label: string; hue: number; chroma: number }> }>(
    inSpace(space, '/meta'),
  ),
  home: (space: string) => get<HomePayload>(inSpace(space, '/home')),
  projects: (space: string) => get<{ projects: ProjectSummary[] }>(inSpace(space, '/projects')),
  project: (space: string, slug: string) => get<ProjectPayload>(inSpace(space, `/projects/${encodeURIComponent(slug)}`)),
  node: (space: string, id: string) => get<NodePayload>(inSpace(space, `/nodes/${encodeURIComponent(id)}`)),
  docs: (space: string) => get<{ docs: NodeSummary[] }>(inSpace(space, '/docs')),
  doc: (space: string, path: string) => get<NodePayload>(inSpace(space, `/docs/${path}`)),
  search: (space: string, q: string, type?: string) =>
    get<{ results: SearchResult[] }>(inSpace(space, `/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`)),
  searchEverywhere: (q: string) => get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  createSpace: (name: string) => send<{ space: SpaceSummary }>('POST', '/api/spaces', { name }),
  updateSpace: (slug: string, patch: { name?: string; description?: string }) =>
    send<{ space: SpaceSummary }>('PATCH', `/api/spaces/${encodeURIComponent(slug)}`, patch),
  setName: (name: string) => send<{ user: UserProfile }>('PATCH', '/api/me', { name }),
};

const LAST_VISIT_KEY = 'wake:last-visit';

/** Returns the previous visit timestamp and stamps now. */
export function takeLastVisit(): string | null {
  const prev = localStorage.getItem(LAST_VISIT_KEY);
  localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
  return prev;
}

export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Terse form for dense lists: "now", "9h", "3d", "Aug 6". */
export function compactTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function eventSummary(a: ActivityRow): string {
  const p = a.payload as Record<string, string | undefined>;
  switch (a.kind) {
    case 'state_changed':
      return `${p.from} → ${p.to}${p.reason ? ` — ${p.reason}` : ''}`;
    case 'note':
      return String(p.text ?? '');
    case 'created':
      return `created this ${p.type ?? 'node'}`;
    case 'linked':
      return p.direction === 'in' ? `linked from another node (${p.type})` : `linked (${p.type})`;
    case 'doc_appended':
      return `appended to § ${p.section}`;
    case 'status_regenerated':
      return 'regenerated status';
    case 'archived':
      return `archived${p.reason ? ` — ${p.reason}` : ''}`;
    case 'unarchived':
      return `restored${p.reason ? ` — ${p.reason}` : ''}`;
    case 'field_updated': {
      const fields = a.payload.fields;
      return `updated ${Array.isArray(fields) ? fields.join(', ') : 'fields'}`;
    }
    default:
      return a.kind;
  }
}
