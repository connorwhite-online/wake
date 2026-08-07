import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, rememberSpace, relTime } from '../api';
import { useAccount } from '../meta';
import { Orb } from './bits';

/** Your profile + the space you're in; opens a menu of the spaces you can reach. */
export default function SpaceSwitcher({ current }: { current: string }) {
  const { user, spaces, reload } = useAccount();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setError('');
    }
  }, [open]);

  const active = spaces.find((s) => s.slug === current);

  const go = (slug: string) => {
    rememberSpace(slug);
    setOpen(false);
    navigate(`/s/${slug}`);
  };

  const create = async (name: string) => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const { space } = await api.createSpace(name.trim());
      await reload();
      go(space.slug);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
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

          {error && <div className="switcher-error">{error}</div>}

          {creating ? (
            <form
              className="switcher-new"
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement;
                void create(input.value);
              }}
            >
              <input name="name" placeholder="Space name" autoFocus disabled={busy} maxLength={80} />
              <button type="submit" disabled={busy}>
                {busy ? '…' : 'Create'}
              </button>
            </form>
          ) : (
            <button className="switcher-item add" onClick={() => setCreating(true)}>
              <span className="switcher-plus">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                  <path d="M12 6v12M6 12h12" />
                </svg>
              </span>
              <span className="switcher-item-body">
                <span className="switcher-item-name">New space</span>
                <span className="switcher-item-meta">a separate boundary, e.g. a client or a side project</span>
              </span>
            </button>
          )}

          <button
            className="switcher-item quiet"
            onClick={() => {
              setOpen(false);
              navigate(`/s/${current}/settings`);
            }}
          >
            <span className="switcher-item-body">
              <span className="switcher-item-meta">settings — rename this space, set your name</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
