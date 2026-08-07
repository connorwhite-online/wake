import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { install, memoryBlock, skillMarkdown, skillPath } from '../src/core/install.js';

function tmpDir(prefix = 'wake-claude-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('wake install', () => {
  it('writes a skill Claude Code can discover', () => {
    const dir = tmpDir();
    const result = install({ url: 'https://wake.example.com', claudeDir: dir, skillOnly: true });

    expect(result.skillPath).toBe(skillPath(dir));
    expect(result.skillPath).toBe(path.join(dir, 'skills', 'wake', 'SKILL.md'));

    const { data, content } = matter(fs.readFileSync(result.skillPath, 'utf8'));
    expect(data.name).toBe('wake');
    expect(typeof data.description).toBe('string');
    // the description is the whole trigger mechanism — it has to survive edits
    expect(data.description).toMatch(/wake/i);
    expect(data.description.length).toBeLessThan(1024);
    expect(content).toContain('list_spaces');
    expect(content).toContain('wake://conventions');
  });

  it('writes the memory block that actually drives the behaviour', () => {
    // cold-agent runs: with the skill alone an agent never reached for wake
    // mid-task. The always-in-context block is the half that works.
    const dir = tmpDir();
    const result = install({ url: 'https://wake.example.com', claudeDir: dir, skillOnly: true });

    expect(result.memoryPath).toBe(path.join(dir, 'CLAUDE.md'));
    const body = fs.readFileSync(result.memoryPath, 'utf8');
    expect(body).toContain('list_spaces');
    expect(body).toContain('wake');
    // it is in every session's context on this machine, so it has to stay small
    expect(body.split("\n").length).toBeLessThan(22);
  });

  it('keeps the rest of an existing global CLAUDE.md, and reruns cleanly', () => {
    const dir = tmpDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My rules\n\nAlways use tabs.\n');

    install({ url: 'https://wake.example.com', claudeDir: dir, skillOnly: true });
    install({ url: 'https://wake.example.com', claudeDir: dir, skillOnly: true });

    const body = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(body).toContain('Always use tabs.');
    expect(body.match(/<!-- wake:begin -->/g)).toHaveLength(1);
  });

  it('gates on repo ownership in both halves so unrelated repos stay clean', () => {
    expect(memoryBlock()).toMatch(/no space claims it/i);
    expect(memoryBlock()).toMatch(/ignore wake entirely/i);
    // the gate is the repo match, a fact — never the size of the task, an
    // opinion the model gets to talk itself out of
    expect(memoryBlock()).not.toMatch(/substantial/i);

    // the reason a machine-wide skill is safe: it must decline before it writes
    const body = skillMarkdown();
    expect(body).toContain('remote.origin.url');
    expect(body).toMatch(/do not file/i);
    expect(body).toMatch(/nothing matches/i);
  });

  it('points at the whole account by default, one space when pinned', () => {
    const plain = install({ url: 'https://wake.example.com/', claudeDir: tmpDir(), skillOnly: true });
    expect(plain.endpoint).toBe('https://wake.example.com/mcp');

    const pinned = install({ url: 'https://wake.example.com', space: 'work', claudeDir: tmpDir(), skillOnly: true });
    expect(pinned.endpoint).toBe('https://wake.example.com/s/work/mcp');
  });

  it('rewrites its own skill on rerun rather than stacking copies', () => {
    const dir = tmpDir();
    install({ url: 'https://wake.example.com', claudeDir: dir, skillOnly: true });
    fs.appendFileSync(skillPath(dir), '\nstale edit\n');
    install({ url: 'https://wake.example.com', claudeDir: dir, skillOnly: true });

    const body = fs.readFileSync(skillPath(dir), 'utf8');
    expect(body).not.toContain('stale edit');
    expect(body.match(/^---$/gm)).toHaveLength(2);
  });

  it('registers through the claude CLI, passing the server entry verbatim', () => {
    const calls: { file: string; args: string[] }[] = [];
    const result = install({
      url: 'https://wake.example.com',
      claudeDir: tmpDir(),
      exec: (file, args) => calls.push({ file, args }),
    });

    expect(result.registered).toBe('claude-cli');
    // remove-then-add: add-json has no --force, so without the remove a rerun
    // after the deployment moves would keep the stale URL forever
    expect(calls.map((c) => c.args.slice(0, 3))).toEqual([
      ['mcp', 'remove', 'wake'],
      ['mcp', 'add-json', 'wake'],
    ]);
    expect(calls.every((c) => c.file === 'claude')).toBe(true);
    expect(calls[1].args.slice(-2)).toEqual(['--scope', 'user']);
    expect(JSON.parse(calls[1].args[3])).toEqual({
      type: 'http',
      url: 'https://wake.example.com/mcp',
      headers: { Authorization: 'Bearer ${WAKE_TOKEN}' },
    });
  });

  it('registers even when nothing was there to remove', () => {
    const result = install({
      url: 'https://wake.example.com',
      claudeDir: tmpDir(),
      exec: (_file, args) => {
        if (args[1] === 'remove') throw new Error('no such server');
      },
    });
    expect(result.registered).toBe('claude-cli');
  });

  it('hands back a pasteable command when the claude CLI is missing', () => {
    const result = install({
      url: 'https://wake.example.com',
      claudeDir: tmpDir(),
      exec: () => {
        throw new Error('ENOENT');
      },
    });

    expect(result.registered).toBe('manual');
    expect(result.command).toContain('claude mcp add-json wake');
    expect(result.command).toContain('--scope user');
    expect(result.command).toContain('https://wake.example.com/mcp');
    // the skill still lands — half an install beats none
    expect(fs.existsSync(result.skillPath)).toBe(true);
  });
});
