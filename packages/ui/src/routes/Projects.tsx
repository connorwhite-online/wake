import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, relTime, type ProjectSummary } from '../api';
import { Orb, SectionLabel, StateBadge } from '../components/bits';

const ACTIVE_STATES = ['in-progress', 'blocked'] as const;

export default function Projects() {
  const { space = '' } = useParams<{ space: string }>();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'wake · projects';
  }, []);

  useEffect(() => {
    if (!space) return;
    api
      .projects(space)
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(String(e.message ?? e)));
  }, [space]);

  if (error) return <p className="empty">couldn't load projects — {error}</p>;
  if (!projects) return <p className="empty">…</p>;
  if (!projects.length) {
    return <p className="empty">no projects yet — seed the workspace or let an agent create one over MCP</p>;
  }

  return (
    <div>
      <h1 className="page-title">projects</h1>
      <SectionLabel count={projects.length}>all projects</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        {projects.map((p) => {
          const total = Object.values(p.counts).reduce((a, b) => a + b, 0);
          return (
            <Link key={p.id} to={p.url} className="card card-link">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <Orb name={p.title} size={22} />
                <strong style={{ fontSize: '1.05rem' }}>{p.title}</strong>
                <span className="when" style={{ color: 'var(--ink-faint)', fontSize: '0.78rem' }}>
                  active {relTime(p.last_active ?? p.updated)}
                </span>
              </div>
              <div className="page-meta" style={{ marginTop: '0.45rem', gap: '0.4rem' }}>
                {ACTIVE_STATES.filter((s) => p.counts[s]).map((s) => (
                  <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <StateBadge state={s} />
                    <span style={{ fontSize: '0.8rem' }}>{p.counts[s]}</span>
                  </span>
                ))}
                <span style={{ fontSize: '0.8rem' }}>{total} issues</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
