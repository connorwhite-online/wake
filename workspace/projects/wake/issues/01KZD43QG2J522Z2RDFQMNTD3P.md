---
id: 01KZD43QG2J522Z2RDFQMNTD3P
title: 'Spaces: a profile, many spaces, many projects per space'
created: '2026-08-07T03:26:17.602Z'
updated: '2026-08-07T03:26:17.631Z'
author: claude-code
tags:
  - spaces
  - data-model
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

The structure conflated the space with the project: one workspace holding one project called Wake. The real model is a person who belongs to several spaces, each a boundary of visibility holding many projects.

Each space is its own directory, git repo and index under `$WAKE_HOME/spaces/<slug>`. Pre-spaces volumes fold in automatically, named after their only project. Agents reach every space the token allows through one endpoint; `/s/<slug>/mcp` hands an agent a hub containing only that space, so isolation is structural rather than a filter.
