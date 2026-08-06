#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { resolveWorkspace, requireWorkspace, dbPath } from './core/config.js';
import { openDb } from './core/db.js';
import { fullReindex, catchUp } from './core/indexer.js';
import { CONVENTIONS_PATH, WAKE_DIR } from './core/paths.js';

const program = new Command();
program
  .name('wake')
  .description('wake — agent-operated workspace. Agents move; you read the wake.')
  .option('-s, --space <path>', 'workspace (data repo) path; defaults to $WAKE_SPACE or ~/wake-space');

function findConventionsTemplate(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../CONVENTIONS.template.md'),
    path.resolve(here, '../../CONVENTIONS.template.md'),
    path.resolve(here, '../../../CONVENTIONS.template.md'),
    path.resolve(here, '../../../../CONVENTIONS.template.md'),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

program
  .command('init')
  .description('scaffold a new wake workspace (data repo)')
  .action(() => {
    const ws = resolveWorkspace(program.opts().space);
    for (const dir of ['projects', 'docs', 'artifacts', 'activity', 'threads', 'loops']) {
      fs.mkdirSync(path.join(ws, dir), { recursive: true });
      if (dir === 'threads' || dir === 'loops') {
        fs.writeFileSync(path.join(ws, dir, '.gitkeep'), '');
      }
    }
    const conventions = path.join(ws, CONVENTIONS_PATH);
    if (!fs.existsSync(conventions)) {
      const template = findConventionsTemplate();
      fs.writeFileSync(conventions, template ? fs.readFileSync(template, 'utf8') : '# wake workspace\n');
    }
    const gitignore = path.join(ws, '.gitignore');
    if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, `${WAKE_DIR}/\n`);
    if (!fs.existsSync(path.join(ws, '.git'))) {
      try {
        execSync('git init -q', { cwd: ws });
      } catch {
        console.error('note: git init failed — workspace is usable without git, but you lose history');
      }
    }
    console.log(`initialized wake workspace at ${ws}`);
  });

program
  .command('index')
  .description('update the SQLite index from files')
  .option('--full', 'wipe and rebuild the whole index')
  .action((opts) => {
    const ws = requireWorkspace(program.opts().space);
    const { db, needsReindex } = openDb(dbPath(ws));
    if (opts.full || needsReindex) {
      const { indexed } = fullReindex(ws, db);
      console.log(`full reindex: ${indexed} files`);
    } else {
      const { changed, removed } = catchUp(ws, db);
      console.log(`incremental: ${changed} changed, ${removed} removed`);
    }
    db.close();
  });

program
  .command('seed')
  .description('populate the workspace with a sample project (wake dogfooding itself)')
  .option('--force', 'seed even into a non-empty workspace')
  .action(async (opts) => {
    const ws = resolveWorkspace(program.opts().space);
    const { runSeed } = await import('./seed/seed.js');
    const counts = runSeed(ws, { force: opts.force });
    console.log(
      `seeded ${ws}: ${counts.projects} project, ${counts.issues} issues, ${counts.docs} docs, ${counts.artifacts} artifact`,
    );
  });

program
  .command('mcp')
  .description('run the MCP server on stdio (for Claude Code and other agents)')
  .action(async () => {
    const ws = requireWorkspace(program.opts().space);
    const { runMcpServer } = await import('./mcp/server.js');
    await runMcpServer(ws);
  });

program
  .command('serve')
  .description('serve the reading UI + HTTP API, with a file watcher keeping the index fresh')
  .option('-p, --port <port>', 'port to listen on', '8722')
  .action(async (opts) => {
    const ws = requireWorkspace(program.opts().space);
    const { runHttpServer } = await import('./http/server.js');
    await runHttpServer(ws, Number(opts.port));
  });

program.parseAsync().catch((err) => {
  console.error(`wake: ${err.message}`);
  process.exit(1);
});
