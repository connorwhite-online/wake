---
derived: true
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
generated: 2026-08-06T07:26:12.477Z
generated_by: claude-code
rollup_hash: a778e06a
---

## Summary

The cold-agent test produced an eight-finding friction log; all seven actionable findings are now fixed or explicitly resolved by decision — archive_node landed (with an ADR), create_node grew per-type docs and an initial-state param, projects expose last_active, search snippets are escaped and readable, and write_doc gained a clobber guard. The two roadmap issues left open are the next phases: threads, then loops.

## Recently done

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
| done | 7 |
| todo | 1 |
| triage | 1 |
| **total** | **9** |
