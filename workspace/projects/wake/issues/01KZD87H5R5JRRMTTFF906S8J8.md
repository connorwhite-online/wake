---
id: 01KZD87H5R5JRRMTTFF906S8J8
title: A skill alone does not make an agent track work
created: '2026-08-07T04:38:16.504Z'
updated: '2026-08-07T04:38:16.517Z'
author: claude-code
tags:
  - onboarding
  - finding
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

The first cut of `wake install` shipped only a skill. Cold-agent runs: the skill loaded, the MCP tools connected, the space correctly reported the repo — and the agent still did the coding task and filed nothing.

A skill is **pull**: it fires when the model recognises a need. Tracking work is not a need a model feels while it is deep in someone else's bug; it is a habit another person wants. Only `~/.claude/CLAUDE.md`, which is in context whether or not anyone asks, changed the behaviour.

So install writes both, and they have different jobs: the memory block is the trigger and the repo gate and must stay short, because it costs tokens in every session on the machine including the many with no wake space in sight. The skill holds the contract and loads on demand.
