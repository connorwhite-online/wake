---
id: 01KZD43QNDZ9QPN261GM58BY9Q
title: Cold-agent testing
created: '2026-08-07T03:26:17.773Z'
updated: '2026-08-07T03:26:17.773Z'
author: claude-code
tags: []
links: []
space: home
archived: false
type: doc
---

How wake's agent-facing surface gets tested: give a fresh agent no
documentation and a real task, then read what it did.

## The method

1. Create an environment the agent has never seen — an empty workspace, or an
   unrelated repo with a genuine bug in it.
2. Give it a task in its own terms. For the MCP surface: "work out what this
   tool is and use it." For discoverability: a plain coding task that never
   mentions wake.
3. Do not help. The point is to see what the interface teaches on its own.
4. Read the trail it left, not just its summary.

## Why it works

Unit tests assert that a tool call returns what you expect. They cannot tell
you whether an agent will *reach for the tool at all*, file work in the right
place, or understand the model from the descriptions alone. Those are the
failures that make an agent-native tool useless in practice.

## What it has caught

- The absence of a delete or archive path, which made an agent conservative
  about exploratory writes — the opposite of what this tool wants.
- Search snippets marked with full-width brackets that read as mojibake.
- `create_node`'s per-type shape differences being invisible from the schema.
- An agent filing into an unrelated project because it was the only one in
  the space, since nothing told it to create one.

Each of those became an issue here, and most became a one-line fix. The
friction log is the most valuable artifact these runs produce; the finished
task is almost incidental.

## Running one

Point a headless agent at the deployment with only the MCP tools allowed:

```
claude -p "<a real task>" --mcp-config .mcp.json --allowedTools "mcp__wake__*" ...
```

Then read the space it wrote into. If the trail is wrong, the interface is
wrong — fix the tool descriptions or the instructions, and rerun.
