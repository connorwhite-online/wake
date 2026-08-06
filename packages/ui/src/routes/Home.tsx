import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, takeLastVisit, relTime, type HomePayload } from '../api';
import { Prose, Timeline } from '../components/bits';

export default function Home() {
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState('');
  const sinceRef = useRef<string | null>(null);
  const [since, setSince] = useState<string | null>(null);

  useEffect(() => {
    sinceRef.current = takeLastVisit();
    setSince(sinceRef.current);
    document.title = 'wake · the wake';
  }, []);

  useEffect(() => {
    api
      .home()
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <p className="empty">could not load the wake — {error}</p>;
  if (!data) return <p className="empty">loading…</p>;

  const newCount = since ? data.activity.filter((a) => a.ts > since).length : 0;

  return (
    <div>
      {since && newCount > 0 && (
        <p className="page-meta">since you were away — {newCount} events</p>
      )}

      {data.projects.length === 0 ? (
        <div className="empty">
          nothing here yet. run <code>wake seed</code> to load a project, or connect an agent over MCP to
          start writing.
        </div>
      ) : (
        <>
          <h2 className="section-label">status</h2>
          {data.statuses.length === 0 ? (
            <p className="empty">no status has been generated yet</p>
          ) : (
            data.statuses.map((s) => (
              <div className="status-card" key={s.project_id}>
                <Link to={`/p/${s.slug}`} className="page-title" style={{ fontSize: '1.1rem', display: 'block' }}>
                  {s.title}
                </Link>
                <div className="status-meta">
                  {s.generated ? `regenerated ${relTime(s.generated)}` : 'not yet regenerated'}
                  {s.generated_by ? ` by ${s.generated_by}` : ''}
                </div>
                <Prose html={s.summary_html} />
              </div>
            ))
          )}

          <h2 className="section-label">the wake</h2>
          <Timeline rows={data.activity} since={since} />
        </>
      )}
    </div>
  );
}
