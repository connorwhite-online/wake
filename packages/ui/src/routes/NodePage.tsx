import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, relTime, type NodePayload } from '../api';
import { Prose, StateBadge, TagList, SectionLabel, Timeline } from '../components/bits';

export default function NodePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<NodePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setData(null);
    setError('');
    api
      .node(id)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [id]);

  useEffect(() => {
    if (data) document.title = `wake · ${data.node.title}`;
  }, [data]);

  if (error) return <p className="empty">could not load this node — {error}</p>;
  if (!data) return <p className="empty">loading…</p>;

  const { node, body_html, project, artifact, links, backlinks, activity } = data;

  return (
    <div>
      <h1 className="page-title">{node.title}</h1>
      <div className="page-meta">
        <StateBadge state={node.state} />
        {project && <Link to={`/p/${project.slug}`}>in {project.title}</Link>}
        {node.author && <span>{node.author}</span>}
        <span>created {relTime(node.created)}</span>
        <span>updated {relTime(node.updated)}</span>
        <TagList tags={node.tags} />
      </div>

      {artifact && (
        <p className="page-meta">
          <a href={artifact.url}>
            download {artifact.file} · {artifact.mime}
          </a>
        </p>
      )}

      {body_html && <Prose html={body_html} />}

      {links.length > 0 && (
        <>
          <SectionLabel count={links.length}>links</SectionLabel>
          {links.map((l) => (
            <div key={l.id}>
              {l.kind} → <Link to={l.url}>{l.title}</Link>
            </div>
          ))}
        </>
      )}

      {backlinks.length > 0 && (
        <>
          <SectionLabel count={backlinks.length}>backlinks</SectionLabel>
          {backlinks.map((l) => (
            <div key={l.id}>
              {l.kind} ← <Link to={l.url}>{l.title}</Link>
            </div>
          ))}
        </>
      )}

      <h2 className="section-label">history</h2>
      <Timeline rows={activity} />
    </div>
  );
}
