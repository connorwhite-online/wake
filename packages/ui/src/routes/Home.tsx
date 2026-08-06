import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, takeLastVisit, relTime, type HomePayload } from '../api';
import { Empty, Prose, Timeline } from '../components/bits';

export default function Home() {
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState('');
  const sinceRef = useRef<string | null>(null);
  const [since, setSince] = useState<string | null>(null);

  useEffect(() => {
    sinceRef.current = takeLastVisit();
    setSince(sinceRef.current);
    document.title = 'wake · home';
  }, []);

  useEffect(() => {
    api
      .home()
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <p className="empty">could not load home — {error}</p>;
  if (!data) return <p className="empty">loading…</p>;

  const newCount = since ? data.activity.filter((a) => a.ts > since).length : 0;

  return (
    <div>
      {since && newCount > 0 && (
        <p className="page-meta">since you were away — {newCount} events</p>
      )}

      {data.projects.length === 0 ? (
        <Empty>
          still water — nothing here yet. run <code>wake seed</code> for a sample project, or connect an
          agent over MCP and let it start writing.
        </Empty>
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

          <h2 className="section-label">activity</h2>
          <Timeline rows={data.activity} since={since} />
        </>
      )}
    </div>
  );
}
