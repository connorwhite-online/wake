import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, type ProjectSummary } from '../api';

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// minimal single-path glyphs: wake ripples, folder, page, magnifier
const ICONS = {
  wake: 'M2 12c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 4-2 5 0M2 17c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 4-2 5 0M2 7c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 4-2 5 0',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  docs: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5',
  search: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3',
};

const TABS = [
  { to: '/', label: 'wake', icon: ICONS.wake, end: true },
  { to: '/projects', label: 'projects', icon: ICONS.projects, end: false },
  { to: '/docs', label: 'docs', icon: ICONS.docs, end: false },
  { to: '/search', label: 'search', icon: ICONS.search, end: false },
];

export default function Layout() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
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
          wake
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

      <header className="topbar">
        <Link to="/" className="wordmark">
          wake
        </Link>
      </header>

      <main className="content">
        {/* key on pathname so each navigation re-runs the enter animation */}
        <div className="content-inner view-enter" key={location.pathname + location.search}>
          <Outlet />
        </div>
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <Icon d={t.icon} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
