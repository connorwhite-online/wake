---
id: 01KZD43QN6KJ0664T8037N8G3W
title: 'ADR 003: Wake is its own authorization server'
created: '2026-08-07T03:26:17.766Z'
updated: '2026-08-07T03:26:17.766Z'
author: claude-code
tags: []
links: []
space: home
archived: false
type: doc
---

## Context

The Claude apps' "Add custom connector" flow has no static-token path. It
attempts an OAuth 2.1 handshake — including dynamic client registration —
against any URL you give it, and requests for static-header auth have been
closed as not planned. A self-hosted wake could be reached by Claude Code and
the Messages API, both of which accept bearer tokens, but not from the apps.

## Decision

Wake implements OAuth 2.1 itself rather than delegating to an identity
provider. It is both the resource server and its authorization server.

The owner token is the login: the consent screen asks you to confirm with
`WAKE_TOKEN`. There is no second credential and no user database, because
there is exactly one owner.

**Consent doubles as scope selection.** The screen asks which spaces the
client may reach, and the answer becomes the same `Grant` that a static
`WAKE_TOKEN_<SLUG>` produces. The space-scoping machinery carries an OAuth
connector with no second code path.

## Rationale

- Delegating to a real IdP would mean running or paying for one, for a
  single-user tool whose whole premise is that you own your data.
- Issuing scoped tokens through consent is strictly better than the static
  token it complements: you can hand the Claude app one space and revoke it
  without rotating everything.
- Tokens are stored hashed, so the store is worthless if leaked.

## Consequences

Wake carries auth code, which is a real maintenance surface — it is guarded
by tests covering PKCE failure, code replay, refresh rotation and redirect
validation, and it must be kept honest as the MCP authorization spec moves.

`WAKE_TOKEN` remains the master credential. If it leaks, everything leaks;
OAuth narrows what a *connector* holds, not what the owner holds.
