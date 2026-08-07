---
id: 01KZD43QM6TYZ2MGBTNTVKJ25S
title: A stale WAKE_SPACE pinned the deployment to a directory-named space
created: '2026-08-07T03:26:17.734Z'
updated: '2026-08-07T03:26:17.741Z'
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

The deployed instance showed a space called "workspace" owned by "root". A leftover WAKE_SPACE variable from the pre-spaces deploy beat WAKE_HOME, forcing single-space mode — which names the space after its directory and skips migration. The profile separately fell back to the container's unix user.
