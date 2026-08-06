import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, relTime, type ProjectPayload } from '../api';
import { Prose, TagList, SectionLabel, IssueRow, Timeline } from '../components/bits';

const STATE_ORDER = ['in-progress', 'blocked', 'triage', 'todo', 'done', 'dropped'];

export default function Project() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    setData(null);
    setError('');
    api
      .project(slug)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [slug]);

  useEffect(() => {
    if (data) document.title = `wake · ${data.project.title}`;
  }, [data]);

  if (error) return <p className="empty">could not load this project — {error}</p>;
  if (!data) return <p className="empty">loading…</p>;

  const { project, status, issues, docs, timeline } = data;

  return (
    <div>
      <h1 className="page-title">{project.title}</h1>
      <div className="page-meta">
        {project.author && <span>{project.author}</span>}
        <span>created {relTime(project.created)}</span>
        <TagList tags={project.tags} />
      </div>

      {project.body_html && <Prose html={project.body_html} />}

      <h2 className="section-label">status</h2>
      {status ? (
        <div className="status-card">
          <div className="status-meta">
            {status.generated ? `regenerated ${relTime(status.generated)}` : 'not yet regenerated'}
            {status.generated_by ? ` by ${status.generated_by}` : ''}
          </div>
          <Prose html={status.html} />
        </div>
      ) : (
        <p className="empty">no status has been generated yet — an agent runs regenerate_status to create one</p>
      )}

      {STATE_ORDER.map((state) => {
        const rows = issues[state];
        if (!rows || rows.length === 0) return null;
        return (
          <div key={state}>
            <SectionLabel count={rows.length}>{state}</SectionLabel>
            {rows.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </div>
        );
      })}

      <h2 className="section-label">resources</h2>
      {docs.length === 0 ? (
        <p className="empty">no resources linked yet</p>
      ) : (
        docs.map((doc) => (
          <div key={doc.id}>
            <Link to={doc.url}>{doc.title}</Link>
          </div>
        ))
      )}

      <h2 className="section-label">timeline</h2>
      <Timeline rows={timeline} />
    </div>
  );
}
