---
id: 01KZG1BJBTJQX8NSRDHZK662GG
title: A deployment without WAKE_TOKEN is world-writable
created: '2026-08-08T06:35:52.059Z'
updated: '2026-08-08T06:35:52.059Z'
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

Confirmed against a local instance started with no token: `GET /api/spaces` returns 200, `POST /api/spaces` returns 201, and MCP `initialize` succeeds — read and write, no credential. The server does warn at boot ("anyone who can reach this port can read and write"), but a log line nobody re-reads is not a control.

The production deployment is very likely in this state: its first Railway logs showed no WAKE_TOKEN, and the UI opened in a browser without authenticating.

This also blocks the Claude connector, which is how it surfaced: with no owner token there is nobody to authorize as, so `/oauth/authorize` returns 503. Setting the token closes the exposure and unblocks consent in one move.
