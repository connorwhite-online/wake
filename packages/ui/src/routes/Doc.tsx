import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, relTime, type NodePayload } from '../api';
import { NodeChip, Prose, TagList, SectionLabel } from '../components/bits';

export default function Doc() {
  const { space = '', ...params } = useParams<{ space: string; '*': string }>();
  const path = params['*'] ?? '';
  const [data, setData] = useState<NodePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!space || !path) return;
    setData(null);
    setError('');
    api
      .doc(space, path)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [space, path]);

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
          <div>
            {backlinks.map((l) => (
              <NodeChip key={`${l.id}-${l.kind}`} node={l} kind={l.kind} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
