---
id: 01KZFVH7KGMGS25NGJB33RJG4T
title: Reaching wake from a cloud session
created: '2026-08-08T04:54:06.192Z'
updated: '2026-08-08T04:54:06.192Z'
author: claude-code
tags: []
links: []
space: home
archived: false
type: doc
---

Three things gate a cloud agent's access to a wake deployment. Miss any one
and the tools are simply absent, with nothing said about why — which is what
made this take several sessions to notice.

## 1. Network egress

The deployment host must be on the environment's egress allowlist. Without it
the proxy answers 403 to CONNECT and every request fails before TLS:

```
remote said 403: Host not in allowlist: <host>.
Add this host to your network egress settings to allow access.
```

This one is invisible from inside the session until something actually tries
to connect. Do not route around it — it is an environment setting.

## 2. WAKE_URL

The **base** URL, not a page within it. `https://wake.example.app`, never
`https://wake.example.app/s/<space>` — the `/s/<slug>` path is the reading UI
for one space, and pasting it produces an endpoint of
`…/s/<slug>/mcp` that means something different (a space-scoped connector).

Unset, Claude Code cannot expand `${WAKE_URL}` in .mcp.json, so the server
entry is invalid and gets dropped **silently**. The agent has no way to tell
"wake is not part of this project" from "wake is misconfigured here".

## 3. WAKE_TOKEN

The full-access token. A space-scoped `WAKE_TOKEN_<SLUG>` also works for
reading and writing that space, but not for creating spaces or importing.

## Where these live

Environment variables and network access are both **environment config**, not
repo config — a cloud container is rebuilt per session, so nothing written to
`~/.claude` survives and `wake install` has nothing to attach to. What the
repo contributes is the committed `.mcp.json` and CLAUDE.md block from
`wake connect`; those two plus the three settings above are the whole story.

Changes to environment config apply at container start, so a session already
running will not pick them up. Start a new one.

## Checking it worked

```
wake push --dry-run          # lists files, contacts nothing
wake push --to <slug>        # the real thing
```

If the tools are present but you are unsure they point at the right instance,
`list_spaces` returns the space slugs and the repos each one claims.
