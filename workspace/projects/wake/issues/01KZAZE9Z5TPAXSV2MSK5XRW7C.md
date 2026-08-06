---
id: 01KZAZE9Z5TPAXSV2MSK5XRW7C
title: Search snippet markers read as mojibake in raw JSON
created: '2026-08-06T07:26:12.453Z'
updated: '2026-08-06T07:26:12.456Z'
author: claude-code
tags:
  - friction-log
  - search
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

FTS5 match highlighting used full-width corner brackets (「wake」), which looks like an encoding bug in a raw tool result.

Resolution: plain `**bold**` markers in the MCP-facing snippet, plus a separate `snippet_html` (HTML-escaped, matches in `<b>`) for the UI. The escaping also closed a latent XSS: raw workspace body text was previously injected into the search page unescaped.
