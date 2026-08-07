import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { slugify } from './ids.js';
import { CONVENTIONS_PATH, WAKE_DIR } from './paths.js';
import { Workspace } from './workspace.js';

/**
 * A space is the unit of collaboration and visibility: its own directory, its
 * own git repo, its own index, holding many projects. A user belongs to
 * several; agents reach them all through one endpoint unless scoped to one.
 */
export interface SpaceInfo {
  slug: string;
  name: string;
  description: string;
  /** repos whose work belongs here, e.g. "github.com/you/api" — lets an agent
   *  match the repo it is working in to the space it should write to */
  repos: string[];
  path: string;
}

export interface UserProfile {
  name: string;
  handle: string;
}

const SPACES_DIR = 'spaces';
const USER_FILE = 'user.json';
const SPACE_FILE = 'space.json';
const SPACE_DIRS = ['projects', 'docs', 'artifacts', 'activity', 'threads', 'loops'];

/** True when a directory holds a wake space's content. */
export function looksLikeSpace(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'projects')) || fs.existsSync(path.join(dir, 'docs'));
}

/** The home holds every space plus the user profile: --home > WAKE_HOME > ~/wake. */
export function resolveHome(explicit?: string): string {
  return path.resolve(explicit || process.env.WAKE_HOME || path.join(os.homedir(), 'wake'));
}

export function spacesDir(home: string): string {
  return path.join(home, SPACES_DIR);
}

function conventionsTemplate(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../', '../../', '../../../', '../../../../', '../../../../../']) {
    const candidate = path.resolve(here, rel, 'CONVENTIONS.template.md');
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
  }
  return undefined;
}

function gitInit(dir: string): void {
  if (fs.existsSync(path.join(dir, '.git'))) return;
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  } catch {
    // git is optional — a space works as plain files without it
  }
}

/** Create the directory skeleton for a space (idempotent). */
export function scaffoldSpace(dir: string, name: string, description = ''): SpaceInfo {
  for (const d of SPACE_DIRS) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const d of ['threads', 'loops']) {
    const keep = path.join(dir, d, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
  }
  const conventions = path.join(dir, CONVENTIONS_PATH);
  if (!fs.existsSync(conventions)) {
    fs.writeFileSync(conventions, conventionsTemplate() ?? '# wake space\n');
  }
  const gitignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, `${WAKE_DIR}/\n`);

  const metaPath = path.join(dir, SPACE_FILE);
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({ name, description, repos: [] }, null, 2) + '\n');
  }
  gitInit(dir);
  return readSpace(dir);
}

function readSpace(dir: string): SpaceInfo {
  const slug = path.basename(dir);
  let name = slug;
  let description = '';
  let repos: string[] = [];
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, SPACE_FILE), 'utf8')) as Partial<SpaceInfo>;
    if (typeof meta.name === 'string' && meta.name.trim()) name = meta.name.trim();
    if (typeof meta.description === 'string') description = meta.description;
    if (Array.isArray(meta.repos)) repos = meta.repos.filter((r): r is string => typeof r === 'string');
  } catch {
    // no space.json — the directory name is the name
  }
  return { slug, name, description, repos, path: dir };
}

/** Rename a space or change its description; the slug (its directory) is stable. */
export function updateSpace(spaceDir: string, patch: { name?: string; description?: string }): SpaceInfo {
  const info = readSpace(spaceDir);
  if (typeof patch.name === 'string' && patch.name.trim()) info.name = patch.name.trim().slice(0, 80);
  if (typeof patch.description === 'string') info.description = patch.description.slice(0, 280);
  const { path: _p, slug: _s, ...meta } = info;
  fs.writeFileSync(path.join(spaceDir, SPACE_FILE), JSON.stringify(meta, null, 2) + '\n');
  return info;
}

/** Record that a repo's work belongs in this space (idempotent). */
export function addRepoToSpace(spaceDir: string, repo: string): SpaceInfo {
  const info = readSpace(spaceDir);
  if (!info.repos.includes(repo)) info.repos.push(repo);
  const { path: _p, slug: _s, ...meta } = info;
  fs.writeFileSync(path.join(spaceDir, SPACE_FILE), JSON.stringify(meta, null, 2) + '\n');
  return info;
}

/**
 * Fold a pre-spaces workspace into the new layout. The old container mounted
 * one workspace at <home>/workspace; it becomes a space, named after its only
 * project when there is exactly one (that's the mental model: the Wake space
 * holding the Wake project).
 */
export function migrateLegacyLayout(home: string): SpaceInfo | undefined {
  const root = spacesDir(home);
  if (fs.existsSync(root) && fs.readdirSync(root).some((e) => looksLikeSpace(path.join(root, e)))) {
    return undefined; // already migrated
  }
  const legacy = [path.join(home, 'workspace'), home].find(
    (candidate) => looksLikeSpace(candidate) && !candidate.startsWith(root),
  );
  if (!legacy) return undefined;

  const projectsDir = path.join(legacy, 'projects');
  const projects = fs.existsSync(projectsDir)
    ? fs.readdirSync(projectsDir).filter((e) => fs.existsSync(path.join(projectsDir, e, 'project.md')))
    : [];
  const name = projects.length === 1 ? projects[0] : path.basename(legacy);
  const slug = slugify(name);
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, slug);

  if (legacy === home) {
    // content sits directly in the home dir: move the known subdirs down a level
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(home)) {
      if (entry === SPACES_DIR || entry === USER_FILE) continue;
      fs.renameSync(path.join(home, entry), path.join(target, entry));
    }
  } else {
    fs.renameSync(legacy, target);
  }
  // the index references absolute paths in `files`; drop it and let it rebuild
  fs.rmSync(path.join(target, WAKE_DIR), { recursive: true, force: true });
  console.error(`wake: migrated ${legacy} → ${target} (now the '${slug}' space)`);
  return scaffoldSpace(target, name.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase()).replace(/-/g, ' '));
}

export function listSpaces(home: string): SpaceInfo[] {
  const root = spacesDir(home);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((e) => !e.startsWith('.') && fs.statSync(path.join(root, e)).isDirectory())
    .map((e) => readSpace(path.join(root, e)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createSpace(home: string, name: string): SpaceInfo {
  const slug = slugify(name);
  const dir = path.join(spacesDir(home), slug);
  if (fs.existsSync(dir)) throw new Error(`space '${slug}' already exists`);
  fs.mkdirSync(dir, { recursive: true });
  return scaffoldSpace(dir, name);
}

export function loadUser(home: string): UserProfile {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, USER_FILE), 'utf8')) as Partial<UserProfile>;
    if (raw.name) return { name: raw.name, handle: raw.handle || slugify(raw.name) };
  } catch {
    // no profile yet
  }
  // a container's unix user ("root") is a worse guess than admitting we don't know
  let fallback = process.env.WAKE_USER;
  if (!fallback) {
    const local = os.userInfo().username;
    if (local && !['root', 'node', 'nobody', 'app'].includes(local)) fallback = local;
  }
  fallback ||= 'you';
  return { name: fallback, handle: slugify(fallback) };
}

export function saveUser(home: string, profile: UserProfile): void {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, USER_FILE), JSON.stringify(profile, null, 2) + '\n');
}

/**
 * Holds every space a caller can see, opening each space's index lazily.
 * `visible` scopes the hub to a single space for a space-scoped agent.
 */
export class Hub {
  private opened = new Map<string, Workspace>();

  private constructor(
    readonly home: string,
    private readonly infos: SpaceInfo[],
    /** a fixed hub never widens on refresh — that's what makes scoping a boundary */
    private readonly fixed = false,
  ) {}

  /** Multi-space: a home directory holding spaces/. Migrates a legacy layout. */
  static open(home: string): Hub {
    fs.mkdirSync(spacesDir(home), { recursive: true });
    migrateLegacyLayout(home);
    return new Hub(home, listSpaces(home));
  }

  /** Single-space: point wake straight at one space directory. */
  static single(dir: string): Hub {
    const info = looksLikeSpace(dir) ? readSpace(dir) : scaffoldSpace(dir, path.basename(dir));
    return new Hub(path.dirname(dir), [info], true);
  }

  /** A view of this hub limited to one space (the visibility boundary). */
  scopedTo(slug: string): Hub {
    const info = this.infos.find((s) => s.slug === slug);
    if (!info) throw new Error(`no space '${slug}'`);
    const scoped = new Hub(this.home, [info], true);
    const already = this.opened.get(slug);
    if (already) scoped.opened.set(slug, already);
    return scoped;
  }

  spaces(): SpaceInfo[] {
    return this.infos;
  }

  info(slug: string): SpaceInfo | undefined {
    return this.infos.find((s) => s.slug === slug);
  }

  /** The space used when a caller doesn't name one. */
  defaultSlug(): string | undefined {
    const preferred = process.env.WAKE_DEFAULT_SPACE;
    if (preferred && this.info(preferred)) return preferred;
    return this.infos[0]?.slug;
  }

  workspace(slug: string): Workspace {
    const existing = this.opened.get(slug);
    if (existing) return existing;
    const info = this.info(slug);
    if (!info) throw new Error(`no space '${slug}' — call list_spaces to see what you can reach`);
    const ws = Workspace.open(info.path, slug);
    this.opened.set(slug, ws);
    return ws;
  }

  /** Every visible space, opened. */
  all(): { info: SpaceInfo; ws: Workspace }[] {
    return this.infos.map((info) => ({ info, ws: this.workspace(info.slug) }));
  }

  /** Resolve a node id across every visible space — ULIDs are globally unique. */
  locate(id: string): { info: SpaceInfo; ws: Workspace } | undefined {
    return this.all().find(({ ws }) => ws.nodeRow(id));
  }

  /** Pick up spaces created since this hub opened. Never widens a fixed hub. */
  refresh(): void {
    if (this.fixed) return;
    const fresh = listSpaces(this.home);
    if (fresh.length) this.infos.splice(0, this.infos.length, ...fresh);
  }

  closeAll(): void {
    for (const ws of this.opened.values()) ws.close();
    this.opened.clear();
  }
}
