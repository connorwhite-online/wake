import { useEffect, useState } from 'react';
import { setToken } from '../api';

/** Full-screen unlock shown when the server wants a token (WAKE_TOKEN set). */
export default function Gate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => setLocked(true);
    window.addEventListener('wake:unauthorized', onUnauthorized);
    return () => window.removeEventListener('wake:unauthorized', onUnauthorized);
  }, []);

  if (!locked) return <>{children}</>;

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
      <div className="card view-enter" style={{ width: 'min(22rem, 100%)', textAlign: 'center' }}>
        <div className="wordmark" style={{ justifyContent: 'center', display: 'inline-flex', marginBottom: '0.8rem' }}>
          wake
        </div>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem', margin: '0 0 1rem' }}>
          this workspace is locked — paste its access token
        </p>
        <input
          className="search-input"
          type="password"
          placeholder="token"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              setToken(e.currentTarget.value.trim());
              window.location.reload();
            }
          }}
        />
      </div>
    </div>
  );
}
