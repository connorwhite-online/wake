---
id: 01KZAZE9YNAPEQ60XNHB98DBK4
title: 'Issue states are a vocabulary, not an enforced workflow'
created: '2026-08-06T07:26:12.437Z'
updated: '2026-08-06T07:26:12.441Z'
author: claude-code
tags:
  - friction-log
  - design-decision
links: []
space: home
archived: false
type: issue
state: done
project: 01KZAZE9Y5AGJNDAC3KPSNKGPE
---

set_issue_state accepts triage → in-progress directly, and done → anything. The cold agent flagged this as surprising.

Resolution: **kept, made deliberate.** Agents legitimately jump states (picking work straight from triage, reopening done). Enforcing a graph would fight the primary writer. Now documented in the tool description and CONVENTIONS.md as intentional; the `reason` string is the audit trail. One tightening: same-state no-op transitions are rejected so the activity log never records fake movement.
