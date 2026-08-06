export interface NodeSummary {
  id: string;
  type: 'project' | 'issue' | 'doc' | 'artifact';
  title: string;
  path: string;
  slug: string | null;
  state: string | null;
  project_id: string | null;
  author: string | null;
  created: string;
  updated: string;
  tags: string[];
  url: string;
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
}

export type ProjectSummary = NodeSummary & { counts: Record<string, number>; last_active: string | null };

export interface HomePayload {
  projects: ProjectSummary[];
  statuses: StatusSummary[];
  activity: ActivityRow[];
}

export interface ProjectPayload {
  project: NodeSummary & { body_html: string };
  status: { generated: string | null; generated_by: string | null; html: string } | null;
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

export type SearchResult = NodeSummary & { snippet: string; snippet_html: string; score: number };

const TOKEN_KEY = 'wake:token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Artifact links are browser-native navigations that can't carry a header. */
export function withToken(url: string): string {
  const t = getToken();
  return t ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}` : url;
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

export const api = {
  home: () => get<HomePayload>('/api/home'),
  projects: () => get<{ projects: ProjectSummary[] }>('/api/projects'),
  project: (slug: string) => get<ProjectPayload>(`/api/projects/${encodeURIComponent(slug)}`),
  node: (id: string) => get<NodePayload>(`/api/nodes/${encodeURIComponent(id)}`),
  docs: () => get<{ docs: NodeSummary[] }>('/api/docs'),
  doc: (path: string) => get<NodePayload>(`/api/docs/${path}`),
  search: (q: string, type?: string) =>
    get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`),
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
    case 'field_updated': {
      const fields = a.payload.fields;
      return `updated ${Array.isArray(fields) ? fields.join(', ') : 'fields'}`;
    }
    default:
      return a.kind;
  }
}
