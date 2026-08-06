import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, relTime, type NodePayload } from '../api';
import { Prose, TagList, SectionLabel } from '../components/bits';

export default function Doc() {
  const params = useParams();
  const path = params['*'] ?? '';
  const [data, setData] = useState<NodePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!path) return;
    setData(null);
    setError('');
    api
      .doc(path)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [path]);

  useEffect(() => {
    if (data) document.title = `wake · ${data.node.title}`;
  }, [data]);

  if (error) return <p className="empty">could not load this doc — {error}</p>;
  if (!data) return <p className="empty">loading…</p>;

  const { node, body_html, backlinks } = data;

  return (
    <div>
      <h1 className="page-title">{node.title}</h1>
      <div className="page-meta">
        {node.author && <span>{node.author}</span>}
        <span>updated {relTime(node.updated)}</span>
        <TagList tags={node.tags} />
      </div>

      <Prose html={body_html} />

      {backlinks.length > 0 && (
        <>
          <SectionLabel count={backlinks.length}>backlinks</SectionLabel>
          {backlinks.map((l) => (
            <div key={l.id}>
              {l.title} — {l.kind}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
