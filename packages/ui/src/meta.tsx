import { createContext, useContext, useEffect, useState } from 'react';
import { api, type MePayload, type SpaceSummary, type UserProfile } from './api';

export interface StateStyle {
  label: string;
  hue: number;
  chroma: number;
}

export type StateMap = Record<string, StateStyle>;

/* Mirrors the server defaults — used until /api/s/<space>/meta answers (and as
   the fallback for unknown state keys). */
export const DEFAULT_STATES: StateMap = {
  triage: { label: 'triage', hue: 80, chroma: 0.01 },
  todo: { label: 'todo', hue: 250, chroma: 0.05 },
  'in-progress': { label: 'in progress', hue: 75, chroma: 0.11 },
  blocked: { label: 'blocked', hue: 25, chroma: 0.12 },
  done: { label: 'done', hue: 150, chroma: 0.09 },
  dropped: { label: 'dropped', hue: 80, chroma: 0.005 },
};

const StateContext = createContext<StateMap>(DEFAULT_STATES);

/** Per-space state vocabulary (labels + colors from that space's wake.json). */
export function MetaProvider({ space, children }: { space: string; children: React.ReactNode }) {
  const [states, setStates] = useState<StateMap>(DEFAULT_STATES);
  useEffect(() => {
    setStates(DEFAULT_STATES);
    api
      .meta(space)
      .then((m) => m?.states && setStates({ ...DEFAULT_STATES, ...m.states }))
      .catch(() => {});
  }, [space]);
  return <StateContext.Provider value={states}>{children}</StateContext.Provider>;
}

export function useStateStyle(state: string | null): StateStyle | null {
  const states = useContext(StateContext);
  if (!state) return null;
  return states[state] ?? { label: state, hue: 80, chroma: 0.01 };
}

interface Account {
  user: UserProfile | null;
  spaces: SpaceSummary[];
  loading: boolean;
}

const AccountContext = createContext<Account>({ user: null, spaces: [], loading: true });

/** Who you are and which spaces you can reach — loaded once for the session. */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account>({ user: null, spaces: [], loading: true });
  useEffect(() => {
    api
      .me()
      .then((me: MePayload) => setAccount({ user: me.user, spaces: me.spaces, loading: false }))
      .catch(() => setAccount({ user: null, spaces: [], loading: false }));
  }, []);
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

export function useAccount(): Account {
  return useContext(AccountContext);
}
