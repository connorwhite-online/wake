---
id: 01KZD43QJ30ZD8SQVCEBTR99GG
title: A cold agent in another repo could not find wake
created: '2026-08-07T03:26:17.667Z'
updated: '2026-08-07T03:26:17.684Z'
author: claude-code
tags:
  - mcp
  - onboarding
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

Tool availability is not tool usage. An agent with a coding task in an unrelated repo had no reason to think about wake at all.

Three fixes: the MCP server now sends `instructions` at connect time (the model, how to pick a space, the write rhythm); `wake connect` writes an .mcp.json plus a CLAUDE.md block into a repo; and space.json records which repos a space covers, so an agent can match its own git remote to the right space.
