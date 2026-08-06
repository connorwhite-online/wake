---
id: 01KZAZE9Z1MA91N6PNWN011SZK
title: A project's updated timestamp doesn't move with its issues
created: '2026-08-06T07:26:12.449Z'
updated: '2026-08-06T07:26:12.452Z'
author: claude-code
tags:
  - friction-log
  - index
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

Sort-by-updated on projects could not find recently-active projects, because projects and issues are separate files (correctly — file churn on every child event would pollute git history).

Resolution: `last_active` computed from the activity index (max event timestamp across the project and its issues), returned by MCP `list` for projects and the HTTP API, and used to sort the project list in the UI. The file stays untouched; the index answers the question.
