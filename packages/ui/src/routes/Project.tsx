import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, relTime, type ProjectPayload } from '../api';
import { Empty, NodeChip, Orb, Prose, TagList, SectionLabel, IssueRow, Timeline } from '../components/bits';
import { RollupPanel } from '../components/charts';
import { useStateStyle } from '../meta';

const STATE_ORDER = ['in-progress', 'blocked', 'triage', 'todo', 'done', 'dropped'];
const TIMELINE_PAGE = 12;

function StateLabel({ state }: { state: string }) {
  const style = useStateStyle(state);
  return <>{style?.label ?? state}</>;
}

export default function Project() {
  const { space = '', slug } = useParams<{ space: string; slug: string }>();
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [error, setError] = useState('');
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [showBrief, setShowBrief] = useState(false);

  useEffect(() => {
    if (!space || !slug) return;
    setData(null);
    setError('');
    setShowAllTimeline(false);
    setShowBrief(false);
    api
      .project(space, slug)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [space, slug]);

  useEffect(() => {
    if (data) document.title = `wake · ${data.project.title}`;
  }, [data]);

  if (error) return <p className="empty">could not load this project — {error}</p>;
  if (!data) return <p className="empty">loading…</p>;

  const { project, status, rollup, issues, docs, timeline } = data;
  const openStates = STATE_ORDER.filter((s) => s !== 'done' && s !== 'dropped');
  const closedStates = ['done', 'dropped'];
  const shownTimeline = showAllTimeline ? timeline : timeline.slice(0, TIMELINE_PAGE);

  return (
    <div>
      <div className="project-head">
        <Orb name={project.title} size={34} />
        <div>
          <h1 className="page-title">{project.title}</h1>
          <div className="page-meta">
            {project.author && <span>{project.author}</span>}
            <span>created {relTime(project.created)}</span>
            <TagList tags={project.tags} />
          </div>
        </div>
      </div>

      {/* where it stands: the agent's prose, then the numbers as pictures */}
      <div className="status-card">
        {status ? (
          <>
            <div className="status-meta">
              {status.generated ? `status regenerated ${relTime(status.generated)}` : 'status not yet regenerated'}
              {status.generated_by ? ` by ${status.generated_by}` : ''}
            </div>
            <Prose html={status.summary_html} />
          </>
        ) : (
          <div className="status-meta">
            no written summary yet — an agent runs <code>regenerate_status</code> to add one
          </div>
        )}
        <RollupPanel rollup={rollup} />
      </div>

      {rollup.blocked.length > 0 && (
        <div className="callout blocked">
          <strong>{rollup.blocked.length} blocked</strong>
          {rollup.blocked.slice(0, 3).map((b) => (
            <div key={b.id} className="callout-line">
              {b.title}
              {b.blocked_by.length > 0 && <span className="callout-by"> · waiting on {b.blocked_by.map((x) => x.title).join(', ')}</span>}
            </div>
          ))}
        </div>
      )}
      {rollup.stale.length > 0 && (
        <div className="callout stale">
          <strong>{rollup.stale.length} stale</strong>
          {rollup.stale.slice(0, 3).map((s) => (
            <div key={s.id} className="callout-line">
              {s.title}
              <span className="callout-by"> · quiet since {relTime(s.last_activity ?? s.updated)}</span>
            </div>
          ))}
        </div>
      )}

      {project.body_html && (
        <>
          <button className="disclose" onClick={() => setShowBrief((v) => !v)} aria-expanded={showBrief}>
            {showBrief ? 'hide brief' : 'project brief'}
          </button>
          {showBrief && <Prose html={project.body_html} />}
        </>
      )}

      {openStates.map((state) => {
        const rows = issues[state];
        if (!rows?.length) return null;
        return (
          <div key={state}>
            <SectionLabel count={rows.length}>
              <StateLabel state={state} />
            </SectionLabel>
            {rows.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </div>
        );
      })}

      {closedStates.some((s) => issues[s]?.length) && (
        <>
          <SectionLabel count={closedStates.reduce((n, s) => n + (issues[s]?.length ?? 0), 0)}>closed</SectionLabel>
          {closedStates.flatMap((s) => issues[s] ?? []).map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </>
      )}

      {docs.length > 0 && (
        <>
          <SectionLabel count={docs.length}>resources</SectionLabel>
          <div>
            {docs.map((doc) => (
              <NodeChip key={doc.id} node={doc} />
            ))}
          </div>
        </>
      )}

      <SectionLabel count={timeline.length}>timeline</SectionLabel>
      {timeline.length === 0 ? (
        <Empty>no activity yet — the water is still</Empty>
      ) : (
        <>
          <Timeline rows={shownTimeline} />
          {timeline.length > TIMELINE_PAGE && (
            <button className="disclose" onClick={() => setShowAllTimeline((v) => !v)}>
              {showAllTimeline ? 'show less' : `show all ${timeline.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
