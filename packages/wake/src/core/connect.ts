import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BEGIN = '<!-- wake:begin -->';
const END = '<!-- wake:end -->';

export interface ConnectOptions {
  /** the repo to wire up */
  repoDir: string;
  /** base URL of the wake deployment, or a ${WAKE_URL} placeholder */
  url: string;
  /** slug of the space this repo's work belongs in */
  space?: string;
  /** hand this repo a single-space endpoint instead of the whole account */
  scoped?: boolean;
  /** name of the space, for the prose block */
  spaceName?: string;
}

export interface ConnectResult {
  endpoint: string;
  repo: string | null;
  wroteMcpJson: boolean;
  wroteClaudeMd: boolean;
}

/** Identify a repo the way a person would: its origin remote, else its folder. */
export function repoIdentity(dir: string): string | null {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (remote) {
      return remote
        .replace(/^git@([^:]+):/, '$1/')
        .replace(/^https?:\/\//, '')
        .replace(/^ssh:\/\/git@/, '')
        .replace(/\.git$/, '');
    }
  } catch {
    // not a git repo, or no origin
  }
  const base = path.basename(path.resolve(dir));
  return base || null;
}

export function claudeMdBlock(space: string | undefined, spaceName: string | undefined): string {
  const where = space
    ? `space \`${space}\`${spaceName && spaceName !== space ? ` (${spaceName})` : ''}`
    : 'your wake workspace';
  return [
    BEGIN,
    '## Workspace (wake)',
    '',
    `Work in this repo is tracked in **wake**, ${where}. The \`wake\` MCP tools are`,
    'connected — use them as you work, not only when asked:',
    '',
    '- **Orient first.** `search` wake before starting anything substantial; the',
    '  decision, the doc, or a duplicate issue may already exist.',
    '- **File** multi-step work as an issue (`create_node` with `type: "issue"`)',
    '  before you start, so the trail exists while you work rather than after.',
    '- **Move** it with `set_issue_state` as reality changes, with a real reason.',
    '- **Log** commits, findings and decisions with `log_activity` — derived status',
    '  is computed from that exhaust, so an unlogged hour is an invisible hour.',
    '- **Record** durable knowledge as a doc (`write_doc`), not a buried comment.',
    '- **Close the loop** with `regenerate_status` when the project picture moved.',
    '',
    'Read the `wake://conventions` resource for the full contract.',
    END,
  ].join('\n');
}

/** Merge wake into a repo's .mcp.json without disturbing other servers. */
function upsertMcpJson(file: string, endpoint: string): boolean {
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof config;
    } catch {
      throw new Error(`${file} exists but is not valid JSON — fix or remove it, then rerun`);
    }
  }
  config.mcpServers ??= {};
  config.mcpServers.wake = {
    type: 'http',
    url: endpoint,
    headers: { Authorization: 'Bearer ${WAKE_TOKEN}' },
  };
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return true;
}

/** Replace the wake block in CLAUDE.md, or append one. */
function upsertClaudeMd(file: string, block: string): boolean {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes(BEGIN) && existing.includes(END)) {
    const start = existing.indexOf(BEGIN);
    const end = existing.indexOf(END) + END.length;
    const next = existing.slice(0, start) + block + existing.slice(end);
    if (next === existing) return false;
    fs.writeFileSync(file, next);
    return true;
  }
  const separator = existing.trim() ? `${existing.replace(/\s*$/, '')}\n\n` : '';
  fs.writeFileSync(file, `${separator}${block}\n`);
  return true;
}

/**
 * Wire a repo up to wake: an .mcp.json so agents find the tools, and a
 * CLAUDE.md block so they know when to reach for them. Tool availability is
 * not tool usage — the prose is the half that actually changes behaviour.
 */
export function connectRepo(opts: ConnectOptions): ConnectResult {
  const dir = path.resolve(opts.repoDir);
  if (!fs.existsSync(dir)) throw new Error(`no such directory: ${dir}`);
  const base = opts.url.replace(/\/+$/, '');
  const endpoint = opts.scoped && opts.space ? `${base}/s/${opts.space}/mcp` : `${base}/mcp`;

  return {
    endpoint,
    repo: repoIdentity(dir),
    wroteMcpJson: upsertMcpJson(path.join(dir, '.mcp.json'), endpoint),
    wroteClaudeMd: upsertClaudeMd(path.join(dir, 'CLAUDE.md'), claudeMdBlock(opts.space, opts.spaceName)),
  };
}
