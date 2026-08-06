import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, relTime, type NodeSummary } from '../api';
import { SectionLabel } from '../components/bits';

export default function DocsIndex() {
  const { space = '' } = useParams<{ space: string }>();
  const [docs, setDocs] = useState<NodeSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'wake · resources';
  }, []);

  useEffect(() => {
    if (!space) return;
    api
      .docs(space)
      .then((r) => setDocs(r.docs))
      .catch((e) => setError(String(e.message ?? e)));
  }, [space]);

  if (error) return <p className="empty">could not load resources — {error}</p>;
  if (!docs) return <p className="empty">loading…</p>;
  if (docs.length === 0) return <p className="empty">no resources yet</p>;

  const groups = new Map<string, NodeSummary[]>();
  for (const doc of docs) {
    const stripped = doc.path.replace(/^docs\//, '');
    const parts = stripped.split('/');
    const group = parts.length > 1 ? parts[0] : '· ';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(doc);
  }

  const sortedGroups = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

  return (
    <div>
      <h1 className="page-title">resources</h1>
      {sortedGroups.map((group) => {
        const rows = groups.get(group)!.slice().sort((a, b) => a.title.localeCompare(b.title));
        return (
          <div key={group}>
            <SectionLabel>{group}</SectionLabel>
            {rows.map((doc) => (
              <div key={doc.id}>
                <Link to={doc.url}>{doc.title}</Link>{' '}
                <span className="when">{relTime(doc.updated)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
