---
id: 01KZAZE9ZAHD1HHJ5MDJ4AADNW
title: write_doc silently clobbers concurrent changes
created: '2026-08-06T07:26:12.458Z'
updated: '2026-08-06T07:26:12.460Z'
author: claude-code
tags:
  - friction-log
  - mcp
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

write_doc is a full-body replace; combined with append_doc, a stale copy could silently drop appended content.

Resolution: optional `expect_updated` param — pass the doc's `updated` timestamp from when you read it, and the write fails loudly with a merge instruction if the doc moved since. The description now shouts FULLY REPLACE and points at append_doc for incremental work.
