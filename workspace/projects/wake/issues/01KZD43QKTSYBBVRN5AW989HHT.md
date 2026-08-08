---
id: 01KZD43QKTSYBBVRN5AW989HHT
title: Every orb rendered the same hue
created: '2026-08-07T03:26:17.722Z'
updated: '2026-08-07T03:26:17.728Z'
author: claude-code
tags:
  - ui
  - bug
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

Actor and space orbs hash a name to a hue, but every one of them came out the same salmon. `--orb-a` was composed on `:root`, so its nested `var(--orb-h)` resolved there against the fallback and inherited down already-substituted — a CSS spec subtlety, not a JS bug. Gradient stops are scalars now and resolve on the element.
