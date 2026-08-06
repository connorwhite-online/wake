import { Link } from 'react-router-dom';
import { relTime, eventSummary, type ActivityRow, type NodeSummary } from '../api';
import { useStateStyle } from '../meta';

export function Prose({ html }: { html: string }) {
  // Server-side sanitized (rehype-sanitize) — the only HTML source is our own API.
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Deterministic hue from an actor name → soft gradient orb. No assets, no JS per frame. */
export function orbHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function Orb({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span
      className="orb"
      title={name}
      style={{ ['--orb-h' as string]: orbHue(name), width: size, height: size }}
    />
  );
}

/* Chunky per-state glyphs — 2.6 stroke, one clear shape each. */
function StateIcon({ state }: { state: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (state) {
    case 'triage': // funnel
      return (
        <svg {...common}>
          <path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" />
        </svg>
      );
    case 'todo': // open circle
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case 'in-progress': // half-filled circle
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'blocked': // stop octagon
      return (
        <svg {...common}>
          <path d="M8.5 4h7l4.5 4.5v7L15.5 20h-7L4 15.5v-7L8.5 4z" />
        </svg>
      );
    case 'done': // check circle
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </svg>
      );
    case 'dropped': // slash circle
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M7.5 16.5l9-9" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

export function StateBadge({ state }: { state: string | null }) {
  const style = useStateStyle(state);
  if (!state || !style) return null;
  return (
    <span
      className="state-badge"
      style={{ ['--sh' as string]: style.hue, ['--sc' as string]: style.chroma }}
    >
      <StateIcon state={state} />
      {style.label}
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
          <Orb name={a.actor} />
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
