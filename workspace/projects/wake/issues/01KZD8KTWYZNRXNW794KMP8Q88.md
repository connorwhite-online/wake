---
id: 01KZD8KTWYZNRXNW794KMP8Q88
title: Unset WAKE_URL makes wake vanish with no trace
created: '2026-08-07T04:44:59.678Z'
updated: '2026-08-07T04:44:59.695Z'
author: claude-code
tags:
  - cloud
  - bug
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

A cloud session in this very repo had no wake tools despite `.mcp.json` being committed. Claude Code expands `${WAKE_URL}` in .mcp.json; unset, the entry is invalid and the server is dropped — silently. The agent cannot tell "wake is not part of this project" from "wake is misconfigured here", so it does the work and records nothing.

A/B runs pinned it down: hardcoded URL connects, `${WAKE_URL}` unset gives no tools, `${WAKE_URL}` set connects from a fresh HOME with no approval prompt and no user-scope config. Project-scoped .mcp.json needs no `enabledMcpjsonServers` in headless mode, which had been the other suspect.
