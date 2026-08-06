import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom';
import { api, type ProjectSummary } from '../api';

export default function Layout() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.projects().then((r) => setProjects(r.projects)).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="wordmark">
          wake<span className="tilde">~</span>
        </Link>
        <div className="sidebar-search">
          <input
            ref={searchRef}
            placeholder="search  ⌘K"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                navigate(`/search?q=${encodeURIComponent(e.currentTarget.value.trim())}`);
                e.currentTarget.value = '';
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        <nav className="nav-section">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            the wake
          </NavLink>
          <NavLink to="/docs" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            docs
          </NavLink>
        </nav>
        {projects.length > 0 && (
          <nav className="nav-section">
            <div className="nav-label">projects</div>
            {projects.map((p) => (
              <NavLink key={p.id} to={p.url} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                {p.title}
              </NavLink>
            ))}
          </nav>
        )}
      </aside>
      <main className="content">
        <div className="content-inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
