import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, relTime, withToken, type NodePayload } from '../api';
import { NodeChip, Prose, StateBadge, TagList, SectionLabel, Timeline } from '../components/bits';

export default function NodePage() {
  const { space = '', id } = useParams<{ space: string; id: string }>();
  const [data, setData] = useState<NodePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!space || !id) return;
    setData(null);
    setError('');
    api
      .node(space, id)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [space, id]);

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
        {project && <Link to={`/s/${space}/p/${project.slug}`}>in {project.title}</Link>}
        {node.author && <span>{node.author}</span>}
        <span>created {relTime(node.created)}</span>
        <span>updated {relTime(node.updated)}</span>
        <TagList tags={node.tags} />
      </div>

      {artifact && (
        <p className="page-meta">
          <a href={withToken(artifact.url)}>
            download {artifact.file} · {artifact.mime}
          </a>
        </p>
      )}

      {body_html && <Prose html={body_html} />}

      {links.length > 0 && (
        <>
          <SectionLabel count={links.length}>links</SectionLabel>
          <div>
            {links.map((l) => (
              <NodeChip key={`${l.id}-${l.kind}`} node={l} kind={l.kind} />
            ))}
          </div>
        </>
      )}

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

      <h2 className="section-label">history</h2>
      <Timeline rows={activity} />
    </div>
  );
}
