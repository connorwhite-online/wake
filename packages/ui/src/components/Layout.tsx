import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, rememberSpace, type ProjectSummary } from '../api';
import { MetaProvider } from '../meta';
import SpaceSwitcher from './SpaceSwitcher';

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// chunky glyphs: house, folder, stacked pages, magnifier
const ICONS = {
  home: 'M4 11l8-7 8 7M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5',
  projects: 'M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9.5z',
  resources: 'M7 3.5h7l4.5 4.5v10.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM13.5 3.5V9H19',
  search: 'M11 18.5a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM20.5 20.5l-4-4',
};

export default function Layout() {
  const { space = '' } = useParams<{ space: string }>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!space) return;
    rememberSpace(space);
    setProjects([]);
    api
      .projects(space)
      .then((r) => setProjects(r.projects))
      .catch(() => {});
  }, [space]);

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

  const base = `/s/${space}`;
  const tabs = [
    { to: base, label: 'home', icon: ICONS.home, end: true },
    { to: `${base}/projects`, label: 'projects', icon: ICONS.projects, end: false },
    { to: `${base}/docs`, label: 'resources', icon: ICONS.resources, end: false },
    { to: `${base}/search`, label: 'search', icon: ICONS.search, end: false },
  ];

  return (
    <MetaProvider space={space}>
      <div className="shell">
        <aside className="sidebar">
          <SpaceSwitcher current={space} />
          <div className="sidebar-search">
            <input
              ref={searchRef}
              placeholder="search  ⌘K"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  navigate(`${base}/search?q=${encodeURIComponent(e.currentTarget.value.trim())}`);
                  e.currentTarget.value = '';
                  e.currentTarget.blur();
                }
              }}
            />
          </div>
          <nav className="nav-section">
            <NavLink to={base} end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              home
            </NavLink>
            <NavLink to={`${base}/docs`} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              resources
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
          <SpaceSwitcher current={space} />
        </header>

        <main className="content">
          {/* key on pathname so each navigation re-runs the enter animation */}
          <div className="content-inner view-enter" key={location.pathname + location.search}>
            <Outlet />
          </div>
        </main>

        <nav className="tabbar">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
              <Icon d={t.icon} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </MetaProvider>
  );
}
