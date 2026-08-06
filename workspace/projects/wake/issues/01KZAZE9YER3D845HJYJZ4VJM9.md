---
id: 01KZAZE9YER3D845HJYJZ4VJM9
title: No delete/archive path over MCP
created: '2026-08-06T07:26:12.430Z'
updated: '2026-08-06T07:26:12.436Z'
author: claude-code
tags:
  - friction-log
  - mcp
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

The cold agent's top finding: nothing removes a node, which made it *more cautious about exploratory calls than it should have been* — a mistake was permanent workspace clutter.

Resolution: `archive_node` — soft and reversible. Archived nodes keep their file and full history but leave `list`, `search`, and status rollups. Deliberately no hard delete: "remove from view" and "destroy history" are different verbs, and wake only has the first (see [[ADR 002: Archive, not delete]]).
