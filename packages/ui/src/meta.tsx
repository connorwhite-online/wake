import { createContext, useContext, useEffect, useState } from 'react';

export interface StateStyle {
  label: string;
  hue: number;
  chroma: number;
}

export type StateMap = Record<string, StateStyle>;

/* Mirrors the server defaults — used until /api/meta answers (and as the
   fallback for unknown state keys). */
export const DEFAULT_STATES: StateMap = {
  triage: { label: 'triage', hue: 80, chroma: 0.01 },
  todo: { label: 'todo', hue: 250, chroma: 0.05 },
  'in-progress': { label: 'in progress', hue: 75, chroma: 0.11 },
  blocked: { label: 'blocked', hue: 25, chroma: 0.12 },
  done: { label: 'done', hue: 150, chroma: 0.09 },
  dropped: { label: 'dropped', hue: 80, chroma: 0.005 },
};

const MetaContext = createContext<StateMap>(DEFAULT_STATES);

export function MetaProvider({ children }: { children: React.ReactNode }) {
  const [states, setStates] = useState<StateMap>(DEFAULT_STATES);
  useEffect(() => {
    const token = localStorage.getItem('wake:token');
    fetch('/api/meta', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m?.states && setStates({ ...DEFAULT_STATES, ...m.states }))
      .catch(() => {});
  }, []);
  return <MetaContext.Provider value={states}>{children}</MetaContext.Provider>;
}

export function useStateStyle(state: string | null): StateStyle | null {
  const states = useContext(MetaContext);
  if (!state) return null;
  return states[state] ?? { label: state, hue: 80, chroma: 0.01 };
}
