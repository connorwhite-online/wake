import fs from 'node:fs';
import path from 'node:path';
import { ISSUE_STATES, type IssueState } from './schema.js';

/**
 * Workspace presentation settings, loaded from an optional wake.json at the
 * workspace root. Canonical state KEYS never change — agents, the MCP enum,
 * and the rollup rules depend on their semantics — but what a state is
 * called and colored is the human's call.
 *
 *   { "states": { "in-progress": { "label": "doing", "hue": 300 } } }
 */
export interface StateStyle {
  label: string;
  /** OKLCH hue angle for the state's tint */
  hue: number;
  /** OKLCH chroma for the state's tint */
  chroma: number;
}

export interface WakeSettings {
  states: Record<IssueState, StateStyle>;
}

export const DEFAULT_STATES: Record<IssueState, StateStyle> = {
  triage: { label: 'triage', hue: 80, chroma: 0.01 },
  todo: { label: 'todo', hue: 250, chroma: 0.05 },
  'in-progress': { label: 'in progress', hue: 75, chroma: 0.11 },
  blocked: { label: 'blocked', hue: 25, chroma: 0.12 },
  done: { label: 'done', hue: 150, chroma: 0.09 },
  dropped: { label: 'dropped', hue: 80, chroma: 0.005 },
};

export function loadSettings(root: string): WakeSettings {
  const states = structuredClone(DEFAULT_STATES);
  try {
    const raw = fs.readFileSync(path.join(root, 'wake.json'), 'utf8');
    const parsed = JSON.parse(raw) as { states?: Record<string, Partial<StateStyle>> };
    for (const key of ISSUE_STATES) {
      const custom = parsed.states?.[key];
      if (!custom) continue;
      if (typeof custom.label === 'string' && custom.label.trim()) states[key].label = custom.label.trim();
      if (typeof custom.hue === 'number' && Number.isFinite(custom.hue)) states[key].hue = custom.hue;
      if (typeof custom.chroma === 'number' && Number.isFinite(custom.chroma)) states[key].chroma = custom.chroma;
    }
  } catch {
    // no wake.json (or invalid) — defaults apply
  }
  return { states };
}
