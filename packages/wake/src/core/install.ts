import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mcpEndpoint, mcpServerEntry, upsertClaudeMd } from './connect.js';

export interface InstallOptions {
  /** wake deployment base URL, or a ${WAKE_URL} placeholder */
  url: string;
  /** pin the whole machine to one space instead of the whole account */
  space?: string;
  /** write the skill but leave MCP registration alone */
  skillOnly?: boolean;
  /** where ~/.claude lives; injectable for tests */
  claudeDir?: string;
  /**
   * How to run the claude CLI. Injectable because the real one mutates the
   * developer's own machine — a test that forgets to stub this would quietly
   * register a fake server in whoever ran it.
   */
  exec?: (file: string, args: string[]) => void;
}

export interface InstallResult {
  endpoint: string;
  skillPath: string;
  memoryPath: string;
  /** how the server got registered — or didn't, if the CLI wasn't there */
  registered: 'claude-cli' | 'manual';
  /** the equivalent command, printed when we couldn't run it ourselves */
  command: string;
}

/**
 * The always-in-context half.
 *
 * A skill is *pull*: it fires when the model recognises a need. Cold-agent runs
 * showed that tracking work is not a need a model feels — it is a habit someone
 * else wants — so an agent deep in a coding task never reaches for the skill,
 * even with the tools connected and the skill loaded. Only the memory file,
 * which is in context whether or not anyone asks, actually changes behaviour.
 *
 * So this stays short: it costs tokens in every session on the machine,
 * including the many with no wake space in sight. It carries the trigger and
 * the gate, and hands off to the skill for the contract.
 */
export function memoryBlock(): string {
  // Every clause here is load-bearing. An earlier draft hedged ("work may be
  // tracked… before starting substantial work") and cold-agent runs came out
  // inconsistent: the model judged whether the task was big enough and often
  // decided it wasn't. The gate is the repo match, which is a fact, not the
  // size of the work, which is an opinion.
  return [
    '<!-- wake:begin -->',
    '## Workspace (wake)',
    '',
    'Repos on this machine are tracked in **wake** through the `wake` MCP tools.',
    '',
    'At the start of any task that changes code, call `list_spaces` and compare',
    "this repo's origin remote against each space's `repos`:",
    '',
    '- **No space claims it** — ignore wake entirely for this session. Do not',
    '  create a space or project to make it fit.',
    '- **A space claims it** — wake is not optional here. Invoke the `wake` skill',
    '  and follow it: file the issue before you start, log findings as you go,',
    '  set its state when you finish. Do this for small changes too; the record',
    '  is the point, and it is worth the extra calls.',
    '<!-- wake:end -->',
  ].join('\n');
}

/**
 * The load-on-demand half: the full contract, kept out of context until the
 * memory block above sends an agent here. The MCP server also sends this as
 * `instructions` at connect time, but instructions arrive only once connected
 * and say nothing about whether *this* repo is wake's business.
 */
export function skillMarkdown(): string {
  return `---
name: wake
description: >-
  Track work in wake, the user's own workspace of spaces, projects, issues and
  docs, reachable over the wake MCP tools. Use when starting multi-step work in
  a repo, filing or closing an issue, recording a decision or architectural
  finding, or answering what is in flight. First check whether the current repo
  belongs to a wake space — if it does not, do not file anything.
---

# wake

The person you are working for keeps their projects, issues and decisions in
**wake**. You are expected to write to it as you work, not only read from it.

## Before anything else: is this repo wake's business?

Global tools are not a global mandate. A throwaway repo, a scratch clone, or
someone else's codebase should generate no wake writes at all.

1. Call \`list_spaces\`. Every space lists the repos whose work belongs in it.
2. Get this repo's identity — \`git config --get remote.origin.url\`, normalised
   the way wake stores it (\`github.com/you/api\`), or the directory name outside
   git.
3. **Match.** If a space claims this repo, that is where the work goes.
   - If nothing matches, say nothing and do not file. Mention wake once, in
     passing, only if the user is clearly starting real project work — then let
     it go. Do not create a space or a project to make the repo fit.
   - If exactly one space exists and the user's task is plainly about it, that
     is a reasonable match. Ambiguity is not.

## Then pick the project — by the repo, not by vibes

A space holds many projects. The one you want is the project **for this repo**.

Check the projects \`list_spaces\` returned. If none of them is plainly about this
repo, **create one named after the repo** and use it. Do not file into a project
just because it was the only one there, or because its name sounded adjacent —
the most common failure in practice is work landing in an unrelated project that
happened to be nearby. A project is cheap; misfiled work is worse than an extra
project, because nobody ever finds it again.

## The rhythm

- \`search\` before substantial work: the decision, the doc, or a duplicate issue
  may already exist.
- \`create_node\` (type \`issue\`) for multi-step work, *before* starting, so the
  trail exists while you work rather than being reconstructed after.
- \`set_issue_state\` as reality changes, with a reason worth reading later.
- \`log_activity\` for commits, findings, dead ends. Derived status is computed
  from this exhaust — an unlogged hour is an invisible hour.
- \`write_doc\` for durable knowledge. A doc someone searches for later beats a
  comment nobody finds.
- \`regenerate_status\` when a project's picture moved. Two calls: fetch the
  rollup, then send 2–4 sentences on what moved and what is stuck. Do not
  restate counts — the reading UI draws those as charts beside your prose.

## Do not hand-edit derived state

Issue state changes only through \`set_issue_state\`, \`status.md\` only through
\`regenerate_status\`, \`archived\` only through \`archive_node\`. \`update_node\`
rejects those patches and names the right tool. Nothing is hard-deleted, so
exploratory nodes are cheap.

The \`wake://conventions\` resource has the full contract, and \`wake://spaces\`
the current shape of everything you can reach. Read them rather than guessing.
`;
}

/** Where the personal skill lives. */
export function skillPath(claudeDir: string): string {
  return path.join(claudeDir, 'skills', 'wake', 'SKILL.md');
}

export function writeSkill(claudeDir: string): string {
  const file = skillPath(claudeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, skillMarkdown());
  return file;
}

/** Upsert the wake block into the machine-wide CLAUDE.md, leaving the rest alone. */
export function writeMemory(claudeDir: string): string {
  const file = path.join(claudeDir, 'CLAUDE.md');
  fs.mkdirSync(claudeDir, { recursive: true });
  upsertClaudeMd(file, memoryBlock());
  return file;
}

/**
 * Register wake for every project on this machine.
 *
 * Shells out to `claude mcp add-json` rather than editing ~/.claude.json
 * ourselves: that file is Claude Code's live state, a running session may write
 * it at any moment, and a lost-update there costs the user far more than this
 * command is worth. If the CLI isn't on PATH we hand back the exact command
 * instead of guessing at the format.
 */
function registerUserScope(
  endpoint: string,
  exec: NonNullable<InstallOptions['exec']>,
): { registered: InstallResult['registered']; command: string } {
  const { args, command } = userScopeCommand(endpoint);
  // add-json refuses to overwrite an existing name and has no --force, so a
  // rerun after the deployment moves would silently keep the stale URL. Drop
  // ours first; it is not an error for it to be absent.
  try {
    exec('claude', ['mcp', 'remove', 'wake', '--scope', 'user']);
  } catch {
    // never registered, or a CLI too old to have it — add-json will tell us
  }
  try {
    exec('claude', args);
    return { registered: 'claude-cli', command };
  } catch {
    return { registered: 'manual', command };
  }
}

/** The registration call, as both argv and a pasteable one-liner. */
export function userScopeCommand(endpoint: string): { args: string[]; command: string } {
  const json = JSON.stringify(mcpServerEntry(endpoint));
  return {
    args: ['mcp', 'add-json', 'wake', json, '--scope', 'user'],
    command: `claude mcp remove wake --scope user; claude mcp add-json wake '${json}' --scope user`,
  };
}

const realExec: NonNullable<InstallOptions['exec']> = (file, args) => {
  execFileSync(file, args, { stdio: ['ignore', 'ignore', 'pipe'] });
};

/**
 * Make wake reachable from every session on this machine. Three parts, none of
 * which works alone: the MCP server at user scope so the tools exist, a memory
 * block so an agent thinks to check, and a skill holding the contract it reads
 * once it has. `wake connect` remains the per-repo, committed version, for
 * teammates and cloud sessions; this is the one you run once.
 */
export function install(opts: InstallOptions): InstallResult {
  const claudeDir = opts.claudeDir ?? path.join(os.homedir(), '.claude');
  const endpoint = mcpEndpoint(opts.url, opts.space, Boolean(opts.space));
  const { registered, command } = opts.skillOnly
    ? { registered: 'manual' as const, command: '' }
    : registerUserScope(endpoint, opts.exec ?? realExec);
  return {
    endpoint,
    skillPath: writeSkill(claudeDir),
    memoryPath: writeMemory(claudeDir),
    registered,
    command,
  };
}
