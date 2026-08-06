---
id: 01KZAZE9ZN1EK3ZZTNE71B6XGK
title: 'ADR 002: Archive, not delete'
created: '2026-08-06T07:26:12.469Z'
updated: '2026-08-06T07:26:12.473Z'
author: claude-code
tags: []
links:
  - to: 01KZAZE9Y5AGJNDAC3KPSNKGPE
    type: documents
  - to: 01KZAZE9YER3D845HJYJZ4VJM9
    type: documents
space: home
archived: false
type: doc
---

## Context

The cold-agent test's top friction finding: with no way to remove anything over
MCP, agents become conservative about exploratory writes — the opposite of what
an agent-native workspace wants.

## Decision

Add `archive_node`: a soft, reversible `archived` flag in frontmatter. Archived
nodes keep their file and full activity history but disappear from `list`,
`search`, and status rollups (opt back in with `include_archived`). There is
deliberately **no hard delete over MCP**.

## Rationale

- Files are ground truth and git is the history layer; destroying files from a
  tool call fights both.
- The multiplayer design (PLAN §8) already distinguishes "remove from this
  space" from "delete everywhere" — `archived` is the v1 shape of the first
  verb, and the second can stay a human git operation.
- Cheap archiving changes agent behavior: explore freely, clean up honestly.

## Consequences

Workspace clutter is invisible rather than impossible. If archived volume ever
matters, a `wake gc` that moves long-archived files to a cold directory would
be a human-invoked CLI concern, not an MCP tool.
