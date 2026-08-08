---
id: 01KZD43QH9SA3SA3KTAZK6C7PH
title: 'Visual status: charts computed live from the index'
created: '2026-08-07T03:26:17.641Z'
updated: '2026-08-07T03:26:17.655Z'
author: claude-code
tags:
  - ui
  - status
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

Agent prose was long and restated numbers the UI could draw. The rollup was already a pure function over the index, so charts need no new storage and can never be stale — the API computes it per request. Only the prose is stored.

A stacked state bar with legend, a 30-day activity sparkline, and callouts for blocked and stale. All coloured from the same per-space state tokens, so renaming a state in wake.json flows through the charts.
