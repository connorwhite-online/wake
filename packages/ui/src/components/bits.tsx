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

/**
 * One thing, one line: glyph, title, meta trailing right. Every list in wake
 * is made of these, so issues, docs and results all read the same way.
 */
export function NodeRow({
  to,
  lead,
  title,
  meta,
  dimmed,
}: {
  to: string;
  lead?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  dimmed?: boolean;
}) {
  return (
    <Link to={to} className={`issue-row${dimmed ? ' dropped' : ''}`}>
      {lead}
      <span className="title">{title}</span>
      {meta && <span className="row-meta">{meta}</span>}
      {Chevron}
    </Link>
  );
}

export function IssueRow({ issue }: { issue: NodeSummary & { url: string } }) {
  return (
    <NodeRow
      to={issue.url}
      lead={<StateDot state={issue.state} />}
      title={issue.title}
      dimmed={issue.state === 'dropped'}
      meta={
        <>
          <TagList tags={issue.tags} />
          <span className="when" title={relTime(issue.updated)}>
            {compactTime(issue.updated)}
          </span>
        </>
      }
    />
  );
}

/** A doc in a list — same row language, type glyph instead of a state. */
export function DocRow({ doc }: { doc: NodeSummary & { url: string } }) {
  return (
    <NodeRow
      to={doc.url}
      lead={
        <span className="state-dot" style={{ color: 'var(--ink-faint)' }}>
          <TypeIcon type="doc" />
        </span>
      }
      title={doc.title}
      meta={
        <span className="when" title={relTime(doc.updated)}>
          {compactTime(doc.updated)}
        </span>
      }
    />
  );
}

/** One actor's uninterrupted run of events on one node — a beat of the story. */
interface Beat {
  actor: string;
  nodeId: string;
  nodeTitle: string;
  nodeUrl: string | null;
  ts: string;
  events: ActivityRow[];
}

function toBeats(rows: ActivityRow[]): Beat[] {
  const beats: Beat[] = [];
  for (const row of rows) {
    const last = beats[beats.length - 1];
    if (last && last.actor === row.actor && last.nodeId === row.node_id) {
      last.events.push(row);
      continue;
    }
    beats.push({
      actor: row.actor,
      nodeId: row.node_id,
      nodeTitle: row.node_title ?? row.node_id,
      nodeUrl: row.node_url ?? null,
      ts: row.ts,
      events: [row],
    });
  }
  return beats;
}

function dayLabel(iso: string): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const then = new Date(iso);
  const days = Math.round((start(new Date()) - start(then)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: 'long' });
  return then.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

/**
 * The story of what happened, not a log. Consecutive events by one actor on
 * one node collapse into a beat; beats group under the day they happened; the
 * node leads, because what changed is the story and who did it is attribution.
 */
export function Timeline({
  rows,
  since,
  of,
}: {
  rows: ActivityRow[];
  since?: string | null;
  /** id of the node being viewed — its title is implied, so lead with the actor */
  of?: string;
}) {
  if (!rows.length) return <Empty>no activity yet — the water is still</Empty>;

  const beats = toBeats(rows);
  const firstSeen = since ? beats.findIndex((b) => b.ts <= since) : -1;
  const days: { label: string; beats: Beat[]; from: number }[] = [];
  beats.forEach((beat, i) => {
    const label = dayLabel(beat.ts);
    const bucket = days[days.length - 1];
    if (bucket?.label === label) bucket.beats.push(beat);
    else days.push({ label, beats: [beat], from: i });
  });

  let index = 0;
  return (
    <div className="feed">
      {days.map((day) => (
        <div className="feed-day" key={`${day.label}-${day.from}`}>
          <div className="feed-day-label">{day.label}</div>
          {day.beats.map((beat) => {
            const position = index++;
            const isOwnNode = of !== undefined && beat.nodeId === of;
            return (
              <div key={`${beat.nodeId}-${beat.ts}`}>
                {position === firstSeen && firstSeen > 0 && (
                  <div className="feed-seen">seen before this</div>
                )}
                <div className="beat" style={{ ['--i' as string]: Math.min(position, 10) }}>
                  <Orb name={beat.actor} />
                  <div className="beat-body">
                    <div className="beat-head">
                      {isOwnNode ? (
                        <span className="beat-title">{beat.actor}</span>
                      ) : beat.nodeUrl ? (
                        <Link to={beat.nodeUrl} className="beat-title">
                          {beat.nodeTitle}
                        </Link>
                      ) : (
                        <span className="beat-title">{beat.nodeTitle}</span>
                      )}
                      <span className="when" title={relTime(beat.ts)}>
                        {isOwnNode ? compactTime(beat.ts) : `${beat.actor} · ${compactTime(beat.ts)}`}
                      </span>
                    </div>
                    {beat.events.map((e, k) => (
                      <div className="beat-line" key={`${e.ts}-${k}`}>
                        {eventSummary(e)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
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
