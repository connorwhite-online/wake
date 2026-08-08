---
id: 01KZD8KTXQZ0DEX40FSB60KBPC
title: Wake's own repo had no CLAUDE.md
created: '2026-08-07T04:44:59.703Z'
updated: '2026-08-07T04:44:59.712Z'
author: claude-code
tags:
  - dogfood
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

The repo carried a committed `.mcp.json` but no CLAUDE.md, so the half that actually changes agent behaviour was missing from the one repo where it should have been most obvious. Found by reading the repo while answering how a cloud session picks wake up — not by any test.
