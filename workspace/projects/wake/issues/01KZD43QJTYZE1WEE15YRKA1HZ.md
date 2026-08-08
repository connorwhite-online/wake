---
id: 01KZD43QJTYZE1WEE15YRKA1HZ
title: OAuth 2.1 so wake can be a Claude custom Connector
created: '2026-08-07T03:26:17.690Z'
updated: '2026-08-07T03:26:17.704Z'
author: claude-code
tags:
  - auth
  - mcp
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

The Claude apps' connector flow has no static-token path — it attempts an OAuth handshake regardless — so wake is now its own authorization server.

RFC 9728 protected-resource metadata with a WWW-Authenticate challenge, RFC 8414 server metadata, RFC 7591 dynamic client registration, and an authorization-code flow with mandatory PKCE S256. Consent doubles as scope selection: the screen asks which spaces the client may reach, and that answer becomes the same Grant a static token produces.
