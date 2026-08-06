import { Link } from 'react-router-dom';
import { relTime, eventSummary, type ActivityRow, type NodeSummary } from '../api';

export function Prose({ html }: { html: string }) {
  // Server-side sanitized (rehype-sanitize) — the only HTML source is our own API.
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

const STATE_VAR: Record<string, string> = {
  triage: 'var(--state-triage)',
  todo: 'var(--state-todo)',
  'in-progress': 'var(--state-in-progress)',
  blocked: 'var(--state-blocked)',
  done: 'var(--state-done)',
  dropped: 'var(--state-dropped)',
};

export function StateBadge({ state }: { state: string | null }) {
  if (!state) return null;
  return (
    <span className="state-badge">
      <span className="state-dot" style={{ background: STATE_VAR[state] ?? 'var(--ink-faint)' }} />
      {state}
    </span>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="tag-list">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </span>
  );
}

export function IssueRow({ issue }: { issue: NodeSummary }) {
  return (
    <div className={`issue-row${issue.state === 'dropped' ? ' dropped' : ''}`}>
      <StateBadge state={issue.state} />
      <Link to={issue.url} className="title">
        {issue.title}
      </Link>
      <TagList tags={issue.tags} />
      <span className="when">{relTime(issue.updated)}</span>
    </div>
  );
}

export function Timeline({ rows, since }: { rows: ActivityRow[]; since?: string | null }) {
  if (!rows.length) return <p className="empty">no activity yet — the water is still</p>;
  return (
    <ul className="timeline">
      {rows.map((a, i) => (
        <li key={`${a.node_id}-${a.ts}-${i}`}>
          <span className="what">
            {since && a.ts > since && <span className="new-marker" title="since your last visit" />}
            <span className="actor">{a.actor}</span>{' '}
            <span className="on-node">
              {a.kind === 'created' ? 'created' : 'on'}{' '}
              {a.node_url ? <Link to={a.node_url}>{a.node_title ?? a.node_id}</Link> : (a.node_title ?? a.node_id)}
            </span>
          </span>
          <span className="when">{relTime(a.ts)}</span>
          <span className="summary">{eventSummary(a)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="section-label">
      {children}
      {count !== undefined && <span className="count">{count}</span>}
    </h2>
  );
}
