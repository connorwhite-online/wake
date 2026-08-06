import { Link } from 'react-router-dom';
import { relTime, compactTime, eventSummary, type ActivityRow, type NodeSummary } from '../api';
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

/* State icons — Linear's circle language: one family, meaning at a glance. */
function StateIcon({ state }: { state: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (state) {
    case 'triage': // dashed circle: exists, not yet real
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" strokeDasharray="3.2 3.4" />
        </svg>
      );
    case 'todo': // open circle: ready
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case 'in-progress': // pie half-fill: underway
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'blocked': // filled bar across: stopped
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M8.5 12h7" strokeWidth="2.6" />
        </svg>
      );
    case 'done': // filled circle, knocked-out check
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
          <path d="M8.4 12.4l2.4 2.4 4.6-4.9" stroke="var(--card)" strokeWidth="2.4" />
        </svg>
      );
    case 'dropped': // dashed circle with slash: let go
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" strokeDasharray="3.2 3.4" />
          <path d="M8.5 15.5l7-7" />
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

/** The glyph alone, state-colored — for dense lists where the group header carries the name. */
export function StateDot({ state }: { state: string | null }) {
  const style = useStateStyle(state);
  if (!state || !style) return null;
  return (
    <span
      className="state-dot"
      title={style.label}
      aria-label={style.label}
      style={{ ['--sh' as string]: style.hue, ['--sc' as string]: style.chroma }}
    >
      <StateIcon state={state} />
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

/* Type glyphs shared by NodeChip and search results (mirrors the wiki-link masks). */
export function TypeIcon({ type }: { type: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (type) {
    case 'project':
      return (
        <svg {...common}>
          <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9.5z" />
        </svg>
      );
    case 'issue':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case 'artifact':
      return (
        <svg {...common}>
          <path d="M8 12.5l6.5-6.5a3 3 0 0 1 4.5 4.5l-8 8a5 5 0 0 1-7-7l7.5-7.5" />
        </svg>
      );
    default: // doc / resource
      return (
        <svg {...common}>
          <path d="M7 3.5h7l4.5 4.5v10.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM13.5 3.5V9H19" />
        </svg>
      );
  }
}

/** A node as a tactile object: icon + title (+ optional relationship kind). */
export function NodeChip({ node, kind }: { node: NodeSummary & { url: string }; kind?: string }) {
  return (
    <Link to={node.url} className="node-chip">
      <TypeIcon type={node.type} />
      <span className="chip-title">{node.title}</span>
      {kind && <span className="chip-kind">{kind}</span>}
    </Link>
  );
}

const Chevron = (
  <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5.5l6.5 6.5L9 18.5" />
  </svg>
);

/** One issue, one line: glyph, title, then meta trailing right (Linear's list). */
export function IssueRow({ issue }: { issue: NodeSummary & { url: string } }) {
  return (
    <Link to={issue.url} className={`issue-row${issue.state === 'dropped' ? ' dropped' : ''}`}>
      <StateDot state={issue.state} />
      <span className="title">{issue.title}</span>
      <span className="row-meta">
        <TagList tags={issue.tags} />
        <span className="when" title={relTime(issue.updated)}>
          {compactTime(issue.updated)}
        </span>
      </span>
      {Chevron}
    </Link>
  );
}

export function Timeline({ rows, since }: { rows: ActivityRow[]; since?: string | null }) {
  if (!rows.length) return <Empty>no activity yet — the water is still</Empty>;
  return (
    <ul className="timeline">
      {rows.map((a, i) => (
        <li key={`${a.node_id}-${a.ts}-${i}`} style={{ ['--i' as string]: Math.min(i, 10) }}>
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

/** Friendly empty state: an orb in a soft dashed panel. */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-panel">
      <Orb name="wake" size={30} />
      <span>{children}</span>
    </div>
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
