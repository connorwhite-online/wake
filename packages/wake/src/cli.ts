#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { openDb } from './core/db.js';
import { dbPath } from './core/config.js';
import { fullReindex, catchUp } from './core/indexer.js';
import {
  Hub,
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
  if (!home && process.env.WAKE_SPACE) {
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
