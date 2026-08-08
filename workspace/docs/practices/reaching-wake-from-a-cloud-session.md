---
id: 01KZFVH7KGMGS25NGJB33RJG4T
title: Reaching wake from a cloud session
created: '2026-08-08T04:54:06.192Z'
updated: '2026-08-08T04:56:52.988Z'
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

## Where the settings actually are

**There is no settings page.** The docs say so outright: "There's no settings
page or direct URL for the selector." Anything describing one is describing
something that does not exist, which is a trap worth naming because the
plausible-sounding wrong answer is easy to produce.

At [claude.ai/code](https://claude.ai/code), the control is the **cloud icon
showing the current environment's name, in the row above the message box** —
the composer row, not a menu. Hover an environment there for a gear icon, or
choose **Add cloud environment**.

The feature is called a **cloud environment**. Searching for "environment
settings" finds nothing.

## 1. Network egress

In the environment dialog, **Network access** takes one of four levels:
`None`, `Trusted`, `Full`, `Custom`. A deployment on your own domain is not
in the Trusted list, so choose **Custom** and add the host to **Allowed
domains**, one per line:

```
wake.example.app
```

Tick **"Also include default list of common package managers"** unless you
want to lose npm, GitHub raw and the rest.

Without this the proxy answers 403 to CONNECT and every request fails before
TLS, long before a credential would matter:

```
remote said 403: Host not in allowlist: <host>.
Add this host to your network egress settings to allow access.
```

Traffic from a **claude.ai connector** is fetched by Anthropic's servers
rather than the session VM, so the OAuth connector route needs no allowlist
entry at all. This applies to the session's own network: `wake push`, and an
MCP server the session starts from `.mcp.json`.

## 2. WAKE_URL

Set in the same dialog, in `.env` format, one `KEY=value` per line.

Use the **base** URL, not a page within it. `https://wake.example.app`, never
`https://wake.example.app/s/<space>` — the `/s/<slug>` path is the reading UI
for one space, and pasting it yields a `…/s/<slug>/mcp` endpoint, which is a
space-scoped connector rather than the account one. It half-works, which is
worse than failing.

Unset, Claude Code cannot expand `${WAKE_URL}` in .mcp.json, so the entry is
invalid and gets dropped **silently**. An agent then cannot tell "wake is not
part of this project" from "wake is misconfigured here".

## 3. WAKE_TOKEN

The full-access token. A space-scoped `WAKE_TOKEN_<SLUG>` also reads and
writes that space, but cannot create spaces or import.

**Note what you are trading.** Cloud environments have no secrets store, and
the dialog warns against putting credentials in them: anyone who can use the
environment can read the value. On a personal environment that is only you.
If that is not acceptable, use the OAuth connector instead — consent issues a
scoped grant, so no token is stored in environment config at all.

## Timing

Environment config is copied once at container start. A session already
running keeps the values it started with, so changes need a new session.

## Checking it worked

```
wake push --dry-run          # lists files, contacts nothing
wake push --to <slug>        # the real thing
```

`list_spaces` returns the space slugs and the repos each claims, which is the
quickest way to confirm the tools point at the instance you meant.
