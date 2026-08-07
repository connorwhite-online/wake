<!-- wake:begin -->
## Workspace (wake)

Work in this repo is tracked in **wake**, space `workspace`. The `wake` MCP tools are
connected — use them as you work, not only when asked:

- **Orient first.** `search` wake before starting anything substantial; the
  decision, the doc, or a duplicate issue may already exist.
- **Find or create the project.** If no project in that space corresponds to
  this repo, create one rather than filing into an unrelated project because
  it happened to be the only one there.
- **File** multi-step work as an issue (`create_node` with `type: "issue"`)
  before you start, so the trail exists while you work rather than after.
- **Move** it with `set_issue_state` as reality changes, with a real reason.
- **Log** commits, findings and decisions with `log_activity` — derived status
  is computed from that exhaust, so an unlogged hour is an invisible hour.
- **Record** durable knowledge as a doc (`write_doc`), not a buried comment.
- **Close the loop** with `regenerate_status` when the project picture moved.

Read the `wake://conventions` resource for the full contract.

If the `wake` tools are **not** available in this session, `WAKE_URL` and
`WAKE_TOKEN` are unset in this environment — a cloud session gets them from
its environment config, not from the repo. Say so instead of carrying on
quietly, or the work goes unrecorded and nobody finds out until later.
<!-- wake:end -->
