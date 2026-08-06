import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rememberSpace, relTime } from '../api';
import { useAccount } from '../meta';
import { Orb } from './bits';

/** Your profile + the space you're in; opens a menu of the spaces you can reach. */
export default function SpaceSwitcher({ current }: { current: string }) {
  const { user, spaces } = useAccount();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = spaces.find((s) => s.slug === current);

  const go = (slug: string) => {
    rememberSpace(slug);
    setOpen(false);
    navigate(`/s/${slug}`);
  };

  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Orb name={active?.name ?? current} size={26} />
        <span className="switcher-labels">
          <span className="switcher-space">{active?.name ?? current}</span>
          {user && <span className="switcher-user">{user.name}</span>}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10l4-4 4 4M8 14l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="switcher-menu">
          <div className="switcher-heading">your spaces</div>
          {spaces.map((s) => (
            <button
              key={s.slug}
              className={`switcher-item${s.slug === current ? ' active' : ''}`}
              onClick={() => go(s.slug)}
            >
              <Orb name={s.name} size={22} />
              <span className="switcher-item-body">
                <span className="switcher-item-name">{s.name}</span>
                <span className="switcher-item-meta">
                  {s.projects} project{s.projects === 1 ? '' : 's'} · {s.issues} issue{s.issues === 1 ? '' : 's'}
                  {s.last_active ? ` · ${relTime(s.last_active)}` : ''}
                </span>
              </span>
            </button>
          ))}
          {spaces.length === 0 && <div className="switcher-empty">no spaces yet</div>}
          <div className="switcher-foot">
            new spaces come from the CLI: <code>wake space new "Name"</code>
          </div>
        </div>
      )}
    </div>
  );
}
