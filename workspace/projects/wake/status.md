---
derived: true
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
generated: 2026-08-07T04:44:59.735Z
generated_by: claude-code
rollup_hash: 17bb18eb
---

## Summary

Reaching wake from a cloud session turned out to need nothing built: a committed .mcp.json plus two environment variables, with wake install being a local-machine tool that ephemeral containers cannot use. What the investigation did surface was a silent failure — an unset WAKE_URL drops the server with no signal, so an agent cannot distinguish misconfiguration from absence — and the fact that wake's own repo was missing the CLAUDE.md half entirely. Both fixed. The open thread is still project selection: repos map to spaces but not to projects.

## Now

- Narrative pass: one row language, no duplicate counts — updated 2026-08-07

## Recently done

- Wake's own repo had no CLAUDE.md — updated 2026-08-07
- Unset WAKE_URL makes wake vanish with no trace — updated 2026-08-07
- A skill alone does not make an agent track work — updated 2026-08-07
- wake install: reach every session on this machine — updated 2026-08-07
- The image baked in WAKE_SPACE, pinning the deploy to a directory-named space — updated 2026-08-07
- Every orb rendered the same hue — updated 2026-08-07
- Spaces could only be created from the CLI — updated 2026-08-07
- OAuth 2.1 so wake can be a Claude custom Connector — updated 2026-08-07
- A cold agent in another repo could not find wake — updated 2026-08-07
- Visual status: charts computed live from the index — updated 2026-08-07
- Spaces: a profile, many spaces, many projects per space — updated 2026-08-07
- regenerate_status: missing-hash path needed a clearer message — updated 2026-08-06
- write_doc silently clobbers concurrent changes — updated 2026-08-06
- Search snippet markers read as mojibake in raw JSON — updated 2026-08-06
- A project's updated timestamp doesn't move with its issues — updated 2026-08-06
- create_node per-type shapes were invisible in the schema — updated 2026-08-06
- Issue states are a vocabulary, not an enforced workflow — updated 2026-08-06
- No delete/archive path over MCP — updated 2026-08-06

## Counts

| state | count |
|---|---|
| done | 18 |
| in-progress | 1 |
| todo | 2 |
| triage | 1 |
| **total** | **22** |
