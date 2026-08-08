---
id: 01KZG1BJCQKST8AHE45AFW0FMQ
title: Refuse to serve open on a non-loopback bind
created: '2026-08-08T06:35:52.087Z'
updated: '2026-08-08T06:35:52.087Z'
author: claude-code
tags:
  - security
  - deploy
links: []
space: home
archived: false
type: issue
state: todo
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

Open-by-default is correct for `wake serve` on localhost and wrong the moment the host is 0.0.0.0 or a container. Proposal: when the bind address is not loopback and neither WAKE_TOKEN nor any WAKE_TOKEN_<SLUG> is set, refuse to start and say why, with an explicit `--insecure` escape hatch for someone who really means it. A warning that scrolls past during a deploy is not a decision point; a failed boot is.
