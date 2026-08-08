---
id: 01KZFT97MFTB4WWXJTR9AM42BC
title: 'wake push: send a local space into a running instance'
created: '2026-08-08T04:32:15.503Z'
updated: '2026-08-08T04:32:15.518Z'
author: claude-code
tags:
  - sync
  - cli
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

`POST /api/spaces/:slug/import` plus `wake push`. Files, not tool calls: replaying create_node would duplicate activity and lose timestamps, whereas the files *are* the record, so shipping them preserves history exactly.

Merge semantics, so a push can never quietly destroy the copy someone reads:
- **New paths** are written.
- **.ndjson logs** are unioned and re-sorted by ts. Append-only logs are never in conflict; two copies are two subsets of one history.
- **Markdown** takes whichever side is newer by its own frontmatter stamp, in either direction.
- **--overwrite** exists for deliberate restores; the default never needs it.

Paths from the wire are rejected rather than sanitised — a path needing repair is a path we do not understand.
