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
workspace/      # wake's own live workspace — the project tracking itself.
                # Its first issues are the friction log a cold agent filed
                # after exploring the MCP server blind. Read it:
                #   wake serve --space ./workspace
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

## Deploy to the cloud (writable — agents everywhere)

`wake serve` now exposes the MCP server over **streamable HTTP at `/mcp`** in
the same process as the UI and API, so a single deployed instance is both the
write surface for agents anywhere and the reading surface for you.

Deploy the included `Dockerfile` on anything with a persistent disk —
`fly.toml` is ready for Fly.io:

```bash
fly launch --no-deploy
fly volumes create wake_data --size 1
fly secrets set WAKE_TOKEN=$(openssl rand -hex 24)   # required before exposing
fly deploy
```

(No CLI on hand? Railway builds the `Dockerfile` straight from the GitHub
repo in the browser: connect repo → attach a volume at `/data` → set
`WAKE_TOKEN` → deploy.)

Then wake is a URL, and **any agent anywhere** writes to it:

- **Cloud coding agents** — drop this repo's `.mcp.json` into any project
  (it references `WAKE_URL` + `WAKE_TOKEN` from the environment, so no
  secrets are committed). Every Claude Code session spun up on that repo —
  web, mobile, desktop, CI — gets the wake tools automatically. Nothing about
  wake assumes a desktop.
- **Claude apps** — add the `/mcp` URL once as a custom connector and wake's
  tools are available in chats on your phone.
- **One-off** — `claude mcp add --transport http wake https://<app>/mcp
  --header "Authorization: Bearer <token>"`, or any MCP-capable runtime.

The UI at the root prompts once for the token and remembers it.

Env knobs: `WAKE_TOKEN` (bearer auth for `/mcp` and `/api` — without it,
anyone who reaches the port can read and write), `WAKE_GIT_SYNC=1`
(debounced auto-commit of the workspace so git history stays the record),
`WAKE_GIT_PUSH=1` (also push — add a remote with credentials to the volume's
workspace first), `WAKE_HOST`/`PORT`.

## Deploy to Vercel (read-only)

The repo deploys as a **read-only mirror** of `workspace/`: the UI is static,
and the API runs as a serverless function that rebuilds the SQLite index into
`/tmp` on cold start from the workspace files bundled with the deployment.

1. Import the repo in Vercel (or `npx vercel` from the root). `vercel.json`
   already carries the build command, output directory, function config, and
   SPA rewrites — no settings needed.
2. Every push to the production branch redeploys, so the flow is: agents write
   locally over MCP → you commit/push the workspace → the hosted wake updates.
   Reading from your phone needs nothing else.

Writes (MCP, `wake serve` watcher) stay local by design — the deployment is
the reading surface, git is the sync. Set `WAKE_SPACE` in Vercel only if your
workspace lives somewhere other than `workspace/`.

## Customizing states

Issue states keep six canonical keys (`triage | todo | in-progress | blocked |
done | dropped`) — agents and the status rules depend on their semantics — but
what they're **called** and **colored** is yours. Drop a `wake.json` in the
workspace root:

```json
{
  "states": {
    "in-progress": { "label": "doing", "hue": 300 },
    "done": { "label": "shipped" }
  }
}
```

`hue`/`chroma` are OKLCH values feeding the state pills; edits show up on the
next page load, no restart.

## Development

```bash
npm test                     # vitest: store, indexer, rollup, MCP round-trips
npm run dev:ui               # vite dev server proxying /api to :8722
node packages/wake/dist/cli.js index --full --space ~/wake-space   # rebuild index
```

Deleting `.wake/` is always safe — the index rebuilds from files on next open.
