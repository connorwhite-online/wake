# wake

*The trail something leaves as it moves. Agents move; you read the wake.*

wake is a personal workspace that sits between Linear and Notion: a knowledge
store with issue and project tracking, **written to primarily by coding agents
over MCP**, read by a human through a local web UI. Files are ground truth — a
git repo of markdown with YAML frontmatter and NDJSON activity logs. SQLite is
just a disposable index. Status is derived from activity, not dragged across a
board.

See [PLAN.md](./PLAN.md) for the full vision and roadmap. This repo currently
implements Phases 0–2: the data layer, the MCP server, and the reading UI.

## Quickstart

```bash
npm install
npm run build            # builds the server package and the UI

# create a workspace (the data repo — separate from this code repo)
node packages/wake/dist/cli.js init  --space ~/wake-space
node packages/wake/dist/cli.js seed  --space ~/wake-space   # optional demo data

# serve the reading UI
node packages/wake/dist/cli.js serve --space ~/wake-space   # http://localhost:8722
```

Set `WAKE_SPACE=~/wake-space` (or pass `--space` everywhere) to pick your
workspace. `npm link -w packages/wake` puts a global `wake` on your PATH if
you'd rather not type the dist path.

## Connect an agent (Claude Code)

```bash
claude mcp add wake -- node /path/to/wake/packages/wake/dist/cli.js mcp --space ~/wake-space
```

The server exposes tools (`search`, `get_node`, `list`, `create_node`,
`update_node`, `set_issue_state`, `log_activity`, `append_doc`, `write_doc`,
`link`, `regenerate_status`) and resources (`wake://conventions`,
`wake://index/projects`, `wake://docs/...`, `wake://projects/<slug>/status`).

Two rules the server enforces:

- **Derived fields are hands-off.** `update_node` rejects patches to `state`,
  `links`, timestamps, etc., pointing at the right tool instead. `status.md`
  is only ever written by `regenerate_status`.
- **Status prose comes from the calling agent.** `regenerate_status` is a
  two-call handshake: the first call returns a rule-computed rollup (counts,
  blocked, stale, recent activity) plus a hash; the agent writes 2–5 sentences
  of prose and calls again with the hash. If the workspace changed in between,
  the hash is stale and the agent gets the fresh rollup to retry. The server
  never needs an API key — the agent on the other end of the socket is the LLM.

Agents without MCP can work on raw files; `CONVENTIONS.md` (copied into every
workspace by `wake init`) is the contract, and the indexer picks up any
well-formed change.

## Layout

```
packages/wake   # everything server-side: core data layer, SQLite/FTS5 indexer,
                # MCP server (stdio), HTTP API + static UI serving, CLI, seed
packages/ui     # the reading UI (React + Vite): Home ("the wake"), project,
                # issue, docs, search
```

A workspace (data repo) looks like:

```
projects/<slug>/project.md            # authored
projects/<slug>/status.md             # derived — agent-owned
projects/<slug>/issues/<ulid>.md      # + sibling <ulid>.ndjson activity log
docs/<path>.md                        # knowledge, wiki-linked
artifacts/<hash>.<ext> + <hash>.md    # content-addressed blobs + sidecars
activity/log.ndjson                   # workspace-level events
.wake/index.db                        # disposable SQLite index (gitignored)
```

## Development

```bash
npm test                     # vitest: store, indexer, rollup, MCP round-trips
npm run dev:ui               # vite dev server proxying /api to :8722
node packages/wake/dist/cli.js index --full --space ~/wake-space   # rebuild index
```

Deleting `.wake/` is always safe — the index rebuilds from files on next open.
