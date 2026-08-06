import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Debounced git commit (and optional push) of the workspace. Writes now land
 * server-side, so the server keeps the git record that local use got for free.
 * Enabled by WAKE_GIT_SYNC=1; WAKE_GIT_PUSH=1 additionally pushes.
 */
export function startGitSync(root: string, debounceMs = 15_000): { touch: () => void } {
  if (!fs.existsSync(path.join(root, '.git'))) {
    console.error('wake git-sync: workspace is not a git repo — sync disabled');
    return { touch: () => {} };
  }
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let pendingAgain = false;

  async function sync() {
    if (running) {
      pendingAgain = true;
      return;
    }
    running = true;
    try {
      const git = (...args: string[]) =>
        run('git', ['-c', 'user.name=wake', '-c', 'user.email=wake@localhost', ...args], { cwd: root });
      await git('add', '-A');
      const { stdout } = await git('status', '--porcelain');
      if (stdout.trim()) {
        await git('commit', '-m', `wake: sync ${new Date().toISOString()}`);
        if (process.env.WAKE_GIT_PUSH === '1') {
          await git('push').catch((err: Error) => console.error(`wake git-sync: push failed: ${err.message}`));
        }
      }
    } catch (err) {
      console.error(`wake git-sync: ${(err as Error).message}`);
    } finally {
      running = false;
      if (pendingAgain) {
        pendingAgain = false;
        touch();
      }
    }
  }

  function touch() {
    clearTimeout(timer);
    timer = setTimeout(() => void sync(), debounceMs);
    timer.unref?.();
  }

  return { touch };
}
