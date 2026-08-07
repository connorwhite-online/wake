import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connectRepo, repoIdentity } from '../src/core/connect.js';
import { addRepoToSpace, createSpace, listSpaces } from '../src/core/spaces.js';

function tmpDir(prefix = 'wake-repo-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('wake connect', () => {
  it('writes both files a cold agent needs', () => {
    const repo = tmpDir();
    const result = connectRepo({ repoDir: repo, url: 'https://wake.example.com/', space: 'work', spaceName: 'Work' });

    expect(result.endpoint).toBe('https://wake.example.com/mcp');
    const mcp = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.wake).toEqual({
      type: 'http',
      url: 'https://wake.example.com/mcp',
      headers: { Authorization: 'Bearer ${WAKE_TOKEN}' },
    });

    const claude = fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('space `work` (Work)');
    expect(claude).toContain('search');
    expect(claude).toContain('regenerate_status');
    expect(claude).toContain('wake://conventions');
    // unset env vars make the server vanish silently — the block is the only
    // place an agent can learn that absent tools mean misconfiguration
    expect(claude).toContain('WAKE_URL');
    expect(claude).toContain('WAKE_TOKEN');
  });

  it('scopes the endpoint to one space when asked', () => {
    const repo = tmpDir();
    const result = connectRepo({ repoDir: repo, url: 'https://wake.example.com', space: 'work', scoped: true });
    expect(result.endpoint).toBe('https://wake.example.com/s/work/mcp');
  });

  it('merges into an existing .mcp.json instead of clobbering it', () => {
    const repo = tmpDir();
    fs.writeFileSync(
      path.join(repo, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }, null, 2),
    );
    connectRepo({ repoDir: repo, url: 'https://wake.example.com', space: 'work' });
    const mcp = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.other).toEqual({ command: 'other-server' });
    expect(mcp.mcpServers.wake).toBeTruthy();
  });

  it('appends to an existing CLAUDE.md, then replaces its own block on rerun', () => {
    const repo = tmpDir();
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# House rules\n\nRun the tests.\n');
    connectRepo({ repoDir: repo, url: 'https://wake.example.com', space: 'work' });
    let claude = fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('Run the tests.');
    expect(claude).toContain('space `work`');

    connectRepo({ repoDir: repo, url: 'https://wake.example.com', space: 'personal', spaceName: 'Personal' });
    claude = fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('Run the tests.');
    expect(claude).toContain('space `personal`');
    expect(claude).not.toContain('space `work`');
    // exactly one wake block, no matter how often it runs
    expect(claude.match(/<!-- wake:begin -->/g)).toHaveLength(1);
  });

  it('rejects an unparseable .mcp.json rather than destroying it', () => {
    const repo = tmpDir();
    fs.writeFileSync(path.join(repo, '.mcp.json'), '{ not json');
    expect(() => connectRepo({ repoDir: repo, url: 'https://x', space: 'work' })).toThrow(/not valid JSON/);
    expect(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).toBe('{ not json');
  });

  it('identifies a repo by its origin remote so a space can claim it', () => {
    const repo = tmpDir();
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:you/api.git'], { cwd: repo });
    expect(repoIdentity(repo)).toBe('github.com/you/api');

    const home = tmpDir('wake-home-');
    const space = createSpace(home, 'Work');
    addRepoToSpace(space.path, 'github.com/you/api');
    addRepoToSpace(space.path, 'github.com/you/api'); // idempotent
    expect(listSpaces(home)[0].repos).toEqual(['github.com/you/api']);
  });

  it('falls back to the directory name outside git', () => {
    const repo = path.join(tmpDir(), 'my-project');
    fs.mkdirSync(repo);
    expect(repoIdentity(repo)).toBe('my-project');
  });
});
