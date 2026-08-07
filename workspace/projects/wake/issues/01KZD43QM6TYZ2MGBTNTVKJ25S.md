---
id: 01KZD43QM6TYZ2MGBTNTVKJ25S
title: 'The image baked in WAKE_SPACE, pinning the deploy to a directory-named space'
created: '2026-08-07T03:26:17.734Z'
updated: '2026-08-07T03:50:47.169Z'
author: claude-code
tags:
  - bug
  - deploy
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

The deployed instance showed a space called "workspace" owned by "root".

The cause was our own Dockerfile, not the hosting config: the first deploy commit set `ENV WAKE_SPACE=/data/workspace`, and that beat WAKE_HOME, forcing single-space mode — which names the space after its directory and skips migration entirely. Nobody set a variable in the hosting dashboard; the image carried it.

The profile separately fell back to the container's unix user, which is how the owner came out as "root".
