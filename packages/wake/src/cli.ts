#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { openDb } from './core/db.js';
import { dbPath } from './core/config.js';
import { fullReindex, catchUp } from './core/indexer.js';
import { connectRepo } from './core/connect.js';
import { install } from './core/install.js';
import { OAuthProvider } from './core/oauth.js';
import {
  Hub,
  addRepoToSpace,
  createSpace,
  listSpaces,
  loadUser,
  looksLikeSpace,
  resolveHome,
  saveUser,
  scaffoldSpace,
  spacesDir,
} from './core/spaces.js';

const program = new Command();
program
  .name('wake')
  .description('wake — agent-operated workspace. Agents move; you read the wake.')
  .option('--home <path>', 'root holding all your spaces; defaults to $WAKE_HOME or ~/wake')
  .option('-s, --space <slug|path>', 'a space slug within your home, or a path to a single space directory');

/** Multi-space hub, unless --space (or WAKE_SPACE) points straight at one space directory. */
function openHub(): Hub {
  const { home, space } = program.opts<{ home?: string; space?: string }>();
  if (space) {
    const asPath = path.resolve(space);
    if (looksLikeSpace(asPath)) return Hub.single(asPath);
  }
  // WAKE_HOME means multi-space and wins over a lingering WAKE_SPACE from an
  // older deploy — otherwise the stale var pins you to one directory-named space
  if (!home && !process.env.WAKE_HOME && process.env.WAKE_SPACE) {
    const legacy = path.resolve(process.env.WAKE_SPACE);
    if (looksLikeSpace(legacy)) return Hub.single(legacy);
  }
  return Hub.open(resolveHome(home));
}

/** The one space a single-space command should act on. */
function pickSpace(hub: Hub): { slug: string; dir: string } {
  const { space } = program.opts<{ space?: string }>();
  const spaces = hub.spaces();
  if (!spaces.length) throw new Error('no spaces yet — create one with `wake space new <name>`');
  const wanted = space && !looksLikeSpace(path.resolve(space)) ? space : undefined;
  const info = wanted ? hub.info(wanted) : hub.info(hub.defaultSlug()!);
  if (!info) throw new Error(`no space '${wanted}' — try \`wake spaces\``);
  return { slug: info.slug, dir: info.path };
}

program
  .command('init')
  .description('set up your wake home (and optionally a first space)')
  .argument('[space-name]', 'name of a first space to create')
  .action((spaceName?: string) => {
    const home = resolveHome(program.opts().home);
    fs.mkdirSync(spacesDir(home), { recursive: true });
    const user = loadUser(home);
    saveUser(home, user);
    console.log(`wake home ready at ${home} (profile: ${user.name})`);
    if (spaceName) {
      const info = createSpace(home, spaceName);
      console.log(`created space '${info.slug}' at ${info.path}`);
    } else if (listSpaces(home).length === 0) {
      console.log('next: `wake space new <name>` to create your first space');
    }
  });

program
  .command('spaces')
  .description('list your spaces')
  .action(() => {
    const hub = openHub();
    const spaces = hub.spaces();
    if (!spaces.length) {
      console.log('no spaces yet — create one with `wake space new <name>`');
      return;
    }
    for (const info of spaces) {
      const ws = hub.workspace(info.slug);
      const projects = ws.list({ type: 'project' });
      console.log(
        `${info.slug.padEnd(20)} ${info.name.padEnd(24)} ${projects.length} project${projects.length === 1 ? '' : 's'}`,
      );
    }
    hub.closeAll();
  });

const space = program.command('space').description('manage spaces');

space
  .command('new')
  .description('create a space')
  .argument('<name>', 'display name, e.g. "Client Work"')
  .action((name: string) => {
    const home = resolveHome(program.opts().home);
    fs.mkdirSync(spacesDir(home), { recursive: true });
    const info = createSpace(home, name);
    console.log(`created space '${info.slug}' at ${info.path}`);
  });

program
  .command('profile')
  .description('show or set your display name')
  .argument('[name]', 'new display name')
  .action((name?: string) => {
    const home = resolveHome(program.opts().home);
    if (name) {
      saveUser(home, { name, handle: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
      console.log(`profile set: ${name}`);
    } else {
      const user = loadUser(home);
      console.log(`${user.name} (@${user.handle})`);
    }
  });

program
  .command('index')
  .description('update a space index from its files')
  .option('--full', 'wipe and rebuild the whole index')
  .action((opts) => {
    const hub = openHub();
    const { slug, dir } = pickSpace(hub);
    hub.closeAll();
    const { db, needsReindex } = openDb(dbPath(dir, slug));
    if (opts.full || needsReindex) {
      const { indexed } = fullReindex(dir, db);
      console.log(`${slug}: full reindex, ${indexed} files`);
    } else {
      const { changed, removed } = catchUp(dir, db);
      console.log(`${slug}: ${changed} changed, ${removed} removed`);
    }
    db.close();
  });

program
  .command('seed')
  .description('populate a space with a sample project (wake dogfooding itself)')
  .option('--force', 'seed even into a non-empty space')
  .action(async (opts) => {
    const hub = openHub();
    let target: { slug: string; dir: string };
    if (!hub.spaces().length) {
      const home = resolveHome(program.opts().home);
      const info = createSpace(home, 'Wake');
      target = { slug: info.slug, dir: info.path };
    } else {
      target = pickSpace(hub);
    }
    hub.closeAll();
    const { runSeed } = await import('./seed/seed.js');
    const counts = runSeed(target.dir, { force: opts.force });
    console.log(
      `seeded ${target.slug}: ${counts.projects} project, ${counts.issues} issues, ${counts.docs} docs, ${counts.artifacts} artifact`,
    );
  });

const clients = program.command('clients').description('OAuth clients connected to this wake');

clients
  .command('list', { isDefault: true })
  .description('list connected clients')
  .action(() => {
    const home = resolveHome(program.opts().home);
    const list = new OAuthProvider(home).listClients();
    if (!list.length) {
      console.log('no clients yet — added when you authorize wake as a connector');
      return;
    }
    for (const c of list) {
      console.log(`${c.client_id}  ${c.client_name.padEnd(24)} added ${c.created.slice(0, 10)}`);
    }
  });

clients
  .command('revoke')
  .description('revoke a client and every token it holds')
  .argument('<client-id>')
  .action((clientId: string) => {
    const home = resolveHome(program.opts().home);
    const provider = new OAuthProvider(home);
    if (!provider.getClient(clientId)) throw new Error(`no client '${clientId}' — try \`wake clients\``);
    const removed = provider.revokeClient(clientId);
    console.log(`revoked ${clientId} (${removed} token${removed === 1 ? '' : 's'} dropped)`);
  });

program
  .command('connect')
  .description('wire a repo up to wake: writes .mcp.json + a CLAUDE.md block so agents find it and know when to use it')
  .argument('[dir]', 'repo directory', '.')
  .option('--space <slug>', 'the space this repo\'s work belongs in')
  .option('--url <url>', 'wake deployment base URL (default: $WAKE_URL, or the ${WAKE_URL} placeholder)')
  .option('--scoped', 'give this repo a single-space endpoint instead of your whole account')
  .action((dir: string, opts: { space?: string; url?: string; scoped?: boolean }) => {
    const hub = openHub();
    const spaces = hub.spaces();
    // `--space` is also a global flag; accept it from either position
    const asked = opts.space ?? program.opts<{ space?: string }>().space;
    const slug = (asked && hub.info(asked) ? asked : undefined) ?? (spaces.length === 1 ? spaces[0].slug : undefined);
    if (!slug && spaces.length > 1) {
      throw new Error(`which space? pass --space <slug> (${spaces.map((s) => s.slug).join(', ')})`);
    }
    const info = slug ? hub.info(slug) : undefined;
    if (slug && !info) throw new Error(`no space '${slug}' — try \`wake spaces\``);

    const url = opts.url ?? process.env.WAKE_URL ?? '${WAKE_URL}';
    const result = connectRepo({
      repoDir: dir,
      url,
      space: slug,
      spaceName: info?.name,
      scoped: opts.scoped,
    });

    if (info && result.repo) {
      addRepoToSpace(info.path, result.repo);
      console.log(`recorded ${result.repo} in space '${info.slug}'`);
    }
    hub.closeAll();

    console.log(`wrote .mcp.json  → ${result.endpoint}`);
    console.log('wrote CLAUDE.md  → wake usage block');
    if (url.includes('${')) {
      console.log('\nset WAKE_URL and WAKE_TOKEN in the environment where agents run.');
    } else {
      console.log('\nset WAKE_TOKEN in the environment where agents run.');
    }
    console.log('commit both files so every session on this repo picks them up.');
  });

program
  .command('install')
  .description('make wake reachable from every session on this machine: user-scope MCP, a memory block and a skill')
  .option('--url <url>', 'wake deployment base URL (default: $WAKE_URL)')
  .option('--space <slug>', 'pin this machine to one space instead of your whole account')
  .option('--skill-only', 'write the skill and memory block but leave MCP registration to you')
  .action((opts: { url?: string; space?: string; skillOnly?: boolean }) => {
    const asked = opts.space ?? program.opts<{ space?: string }>().space;
    const url = opts.url ?? process.env.WAKE_URL;
    if (!url && !opts.skillOnly) {
      throw new Error('need the deployment URL — pass --url https://… or set WAKE_URL');
    }
    if (asked) {
      const hub = openHub();
      const known = hub.info(asked);
      hub.closeAll();
      if (!known) throw new Error(`no space '${asked}' — try \`wake spaces\``);
    }

    const result = install({ url: url ?? '${WAKE_URL}', space: asked, skillOnly: opts.skillOnly });
    console.log(`wrote memory    → ${result.memoryPath}`);
    console.log(`wrote skill     → ${result.skillPath}`);
    if (opts.skillOnly) {
      console.log('\nskipped MCP registration, as asked.');
      return;
    }
    if (result.registered === 'claude-cli') {
      console.log(`registered wake → ${result.endpoint} (user scope)`);
    } else {
      console.log(`\ncouldn't run the claude CLI — register it yourself with:\n\n  ${result.command}\n`);
    }
    console.log('\nset WAKE_TOKEN in your shell profile so sessions can authenticate.');
    console.log('every repo you open on this machine can now reach wake.');
  });

program
  .command('mcp')
  .description('run the MCP server on stdio (for Claude Code and other agents)')
  .action(async () => {
    const hub = openHub();
    const { runMcpServer } = await import('./mcp/server.js');
    await runMcpServer(hub);
  });

program
  .command('serve')
  .description('serve the reading UI, HTTP API and streamable-HTTP MCP, watching every space')
  .option('-p, --port <port>', 'port to listen on', process.env.PORT || '8722')
  .action(async (opts) => {
    const hub = openHub();
    if (!hub.spaces().length) {
      // an empty home is still servable — the UI shows how to make a space
      scaffoldSpace(path.join(spacesDir(resolveHome(program.opts().home)), 'home'), 'Home');
      hub.refresh();
    }
    const { runHttpServer } = await import('./http/server.js');
    await runHttpServer(hub, Number(opts.port));
  });

program.parseAsync().catch((err) => {
  console.error(`wake: ${err.message}`);
  process.exit(1);
});
