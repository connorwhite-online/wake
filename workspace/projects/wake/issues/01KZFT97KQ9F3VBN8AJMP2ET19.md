---
id: 01KZFT97KQ9F3VBN8AJMP2ET19
title: The repo copy and the deployment never reconciled
created: '2026-08-08T04:32:15.479Z'
updated: '2026-08-08T04:32:15.525Z'
author: claude-code
tags:
  - sync
  - bug
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

Everything recorded in this project for several sessions went into the repo's committed `workspace/`, which the deployment never reads. The container seeds from `/app/workspace` only when the volume is empty, and git sync is one-way out. Two copies, no path between them — so the deployed status still read "the cold-agent test produced an eight-finding friction log" while the repo copy had moved on by thirteen issues.

Worse, it looked like success from inside: a local server on the repo's workspace answers exactly like the real one, so writes were reported as recorded when nobody could read them.
